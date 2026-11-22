"use strict";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { setup, pngImage, createItem, daysAgo } = require("./helpers");

let ctx;
before(async () => {
  ctx = await setup();
});
after(async () => ctx.teardown());

describe("browse and search", () => {
  let bulk;
  before(async () => {
    bulk = await ctx.agent({ email: "bulk@example.com", name: "Bulk Poster" });
    // 25 listings; the distinctive one is the OLDEST so it sits beyond page 1.
    await createItem(bulk, { title: "Vintage brass compass", category: "other", location: "Shaniwar Wada", date: daysAgo(20) });
    for (let i = 0; i < 24; i++) {
      await createItem(bulk, { title: `Blue umbrella ${i}`, category: i % 2 ? "bag" : "other", location: i % 3 ? "Koregaon Park" : "Hinjewadi", date: daysAgo(i % 10) });
    }
  });

  test("paginates with stable totals and finds listings beyond the first page", async () => {
    const anon = ctx.anonymous();
    const page1 = await anon.get("/api/items?type=lost&pageSize=10").expect(200);
    assert.equal(page1.body.total, 25);
    assert.equal(page1.body.totalPages, 3);
    assert.ok(!page1.body.items.some((i) => i.title.includes("compass")));
    const page3 = await anon.get("/api/items?type=lost&pageSize=10&page=3").expect(200);
    assert.equal(page3.body.items.length, 5);
    assert.ok(page3.body.items.some((i) => i.title.includes("compass")));

    const ids = new Set();
    for (const page of [1, 2, 3]) {
      for (const item of (await anon.get(`/api/items?type=lost&pageSize=10&page=${page}`)).body.items) ids.add(item.id);
    }
    assert.equal(ids.size, 25, "pages must not overlap or skip");

    const search = await anon.get("/api/items?q=compass").expect(200);
    assert.equal(search.body.total, 1);
  });

  test("filters by category, location and date range", async () => {
    const anon = ctx.anonymous();
    const bags = await anon.get("/api/items?category=bag").expect(200);
    assert.ok(bags.body.items.every((i) => i.category === "bag"));
    const hinjewadi = await anon.get("/api/items?location=hinjewadi").expect(200);
    assert.ok(hinjewadi.body.total > 0 && hinjewadi.body.items.every((i) => /hinjewadi/i.test(i.location)));
    const range = await anon.get(`/api/items?from=${daysAgo(2)}&to=${daysAgo(0)}&pageSize=50`).expect(200);
    assert.ok(range.body.items.every((i) => i.date >= daysAgo(2)));
  });

  test("distance search uses coordinates without exposing them", async () => {
    const poster = await ctx.agent({ email: "geo@example.com" });
    await createItem(poster, { title: "Red scarf near station", category: "clothing", latitude: "18.5289", longitude: "73.8744" });
    await createItem(poster, { title: "Red scarf in Mumbai", category: "clothing", latitude: "19.0760", longitude: "72.8777" });
    const near = await ctx.anonymous().get("/api/items?q=scarf&lat=18.53&lng=73.87&radiusKm=10&sort=distance").expect(200);
    assert.equal(near.body.total, 1);
    assert.equal(near.body.items[0].title, "Red scarf near station");
    assert.ok(near.body.items[0].distanceKm < 2);
  });

  test("invalid query parameters are rejected", async () => {
    const anon = ctx.anonymous();
    for (const qs of ["type=stolen", "page=0", "pageSize=500", "from=2026-02-30", "sort=distance", "lat=10", "category=cars", "unknown=1"]) {
      const res = await anon.get(`/api/items?${qs}`);
      assert.equal(res.status, 400, `expected 400 for ${qs}`);
      assert.equal(res.body.error.code, "validation_failed");
    }
    assert.equal((await anon.get("/api/items/abc")).status, 400);
    assert.equal((await anon.get("/api/items/999999")).status, 404);
  });
});

describe("listing management", () => {
  test("owner creates, edits (images too) and deletes; changes persist", async () => {
    const owner = await ctx.agent({ email: "editor@example.com", name: "Edit Or" });
    const item = await createItem(owner, { title: "Grey backpack", category: "bag" }, [await pngImage(), await pngImage(300, 200)]);
    const res = await owner
      .patch(`/api/items/${item.id}`)
      .field("title", "Grey Wildcraft backpack")
      .field("removeImageIds", String(item.images[0].id))
      .attach("images", await pngImage(400, 300), "new.png")
      .expect(200);
    assert.equal(res.body.item.title, "Grey Wildcraft backpack");
    assert.equal(res.body.item.images.length, 2);
    assert.equal((await ctx.anonymous().get(item.images[0].url)).status, 404, "removed image is gone");

    const fresh = await ctx.anonymous().get(`/api/items/${item.id}`).expect(200);
    assert.equal(fresh.body.item.title, "Grey Wildcraft backpack");

    await owner.delete(`/api/items/${item.id}`).expect(204);
    assert.equal((await ctx.anonymous().get(`/api/items/${item.id}`)).status, 404);
    assert.equal((await ctx.anonymous().get(fresh.body.item.images[0].url)).status, 404);
  });

  test("rejects future dates and bad fields", async () => {
    const owner = await ctx.agent({ email: "badfields@example.com" });
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const res = await owner
      .post("/api/items")
      .field("type", "lost")
      .field("title", "X")
      .field("category", "cars")
      .field("location", "Pune")
      .field("date", tomorrow);
    assert.equal(res.status, 400);
    const paths = res.body.error.fields.map((f) => f.path).sort();
    assert.deepEqual(paths, ["category", "date", "title"]);
  });

  test("status transitions are enforced", async () => {
    const owner = await ctx.agent({ email: "transitions@example.com" });
    const item = await createItem(owner);
    const bad = await owner.post(`/api/items/${item.id}/status`).send({ status: "returned" });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.error.code, "invalid_transition");
    await owner.post(`/api/items/${item.id}/status`).send({ status: "closed" }).expect(200);
    await owner.post(`/api/items/${item.id}/status`).send({ status: "open" }).expect(200);
  });
});

describe("contact, claim and return journey", () => {
  test("claimant contacts privately, claims, reporter accepts and marks returned", async () => {
    const reporter = await ctx.agent({ email: "finder@example.com", name: "Finder Person" });
    await reporter.patch("/api/account/profile").send({ phone: "+44 7911 123456" }).expect(200);
    const item = await createItem(reporter, {
      type: "found",
      title: "Brown leather wallet",
      category: "wallet",
      ownershipQuestion: "What card is in the front slot?",
    });
    const owner = await ctx.agent({ email: "realowner@example.com", name: "Real Owner" });

    const conv = await owner.post(`/api/items/${item.id}/conversations`).send({ body: "Hi, I think this is mine", clientId: crypto.randomUUID() }).expect(201);
    const claim = await owner.post(`/api/items/${item.id}/claims`).send({ answer: "Library card" }).expect(201);
    assert.equal(claim.body.claim.status, "pending");

    const notes = await reporter.get("/api/notifications").expect(200);
    assert.ok(notes.body.notifications.some((n) => n.type === "message"));
    assert.ok(notes.body.notifications.some((n) => n.type === "claim_received"));

    const view = await reporter.get(`/api/conversations/${conv.body.conversationId}`).expect(200);
    assert.equal(view.body.conversation.claims[0].answer, "Library card");
    assert.equal(view.body.conversation.counterpart.phone, null, "phone hidden by default");

    // Deliberate, reversible phone sharing by the reporter.
    await reporter.post(`/api/conversations/${conv.body.conversationId}/phone-sharing`).send({ share: true }).expect(200);
    const shared = await owner.get(`/api/conversations/${conv.body.conversationId}`).expect(200);
    assert.equal(shared.body.conversation.counterpart.phone, "+447911123456");
    await reporter.post(`/api/conversations/${conv.body.conversationId}/phone-sharing`).send({ share: false }).expect(200);
    assert.equal((await owner.get(`/api/conversations/${conv.body.conversationId}`)).body.conversation.counterpart.phone, null);

    await reporter.post(`/api/claims/${claim.body.claim.id}/accept`).expect(200);
    const claimed = await ctx.anonymous().get(`/api/items/${item.id}`).expect(200);
    assert.equal(claimed.body.item.status, "claimed");

    await reporter.post(`/api/items/${item.id}/status`).send({ status: "returned" }).expect(200);
    const returned = await ctx.anonymous().get(`/api/items/${item.id}`).expect(200);
    assert.equal(returned.body.item.status, "returned");
    assert.equal((await ctx.anonymous().get("/api/items?q=Brown leather wallet")).body.total, 0, "returned items leave the active list");
    assert.equal((await ctx.anonymous().get("/api/items?q=Brown leather wallet&status=returned")).body.total, 1);

    const ownerNotes = await owner.get("/api/notifications").expect(200);
    assert.ok(ownerNotes.body.notifications.some((n) => n.type === "claim_update" && n.data.status === "accepted"));
    assert.ok(ownerNotes.body.notifications.some((n) => n.type === "item_status"));
  });

  test("a third user cannot read conversations, see claims, edit, or moderate", async () => {
    const reporter = await ctx.agent({ email: "r3@example.com" });
    const item = await createItem(reporter, { type: "found", title: "Keys with red tag", category: "keys", ownershipQuestion: "Keychain?" });
    const claimant = await ctx.agent({ email: "c3@example.com" });
    const conv = await claimant.post(`/api/items/${item.id}/conversations`).send({ body: "mine?" }).expect(201);
    const claim = await claimant.post(`/api/items/${item.id}/claims`).send({ answer: "Red tag says HOME" }).expect(201);

    const intruder = await ctx.agent({ email: "intruder@example.com" });
    assert.equal((await intruder.get(`/api/conversations/${conv.body.conversationId}`)).status, 404);
    assert.equal((await intruder.post(`/api/conversations/${conv.body.conversationId}/messages`).send({ body: "hi" })).status, 404);
    const claims = await intruder.get(`/api/items/${item.id}/claims`).expect(200);
    assert.equal(claims.body.claims.length, 0);
    assert.equal((await intruder.post(`/api/claims/${claim.body.claim.id}/accept`)).status, 404);
    assert.equal((await intruder.post(`/api/claims/${claim.body.claim.id}/withdraw`)).status, 404);
    assert.equal((await intruder.patch(`/api/items/${item.id}`).field("title", "Hacked")).status, 403);
    assert.equal((await intruder.delete(`/api/items/${item.id}`)).status, 403);
    assert.equal((await intruder.post(`/api/items/${item.id}/status`).send({ status: "closed" })).status, 403);
    assert.equal((await intruder.get("/api/moderation/queue")).status, 403);
    assert.equal((await intruder.post(`/api/moderation/items/${item.id}/remove`).send({ reason: "nope" })).status, 403);
    assert.equal((await intruder.get(`/api/items/${item.id}/matches`)).status, 403);
    // Claimant can't accept their own claim either.
    assert.equal((await claimant.post(`/api/claims/${claim.body.claim.id}/accept`)).status, 403);
    const anon = ctx.anonymous();
    assert.equal((await anon.get("/api/conversations")).status, 401);
    assert.equal((await anon.get("/api/notifications")).status, 401);
  });

  test("duplicate and concurrent claim actions stay consistent", async () => {
    const reporter = await ctx.agent({ email: "race@example.com" });
    const item = await createItem(reporter, { type: "found", title: "Black umbrella", category: "other" });
    const a = await ctx.agent({ email: "race-a@example.com" });
    const b = await ctx.agent({ email: "race-b@example.com" });

    // Same claimant submits twice at once: exactly one pending claim.
    const [s1, s2] = await Promise.all([
      a.post(`/api/items/${item.id}/claims`).send({ answer: "It has a wooden handle" }),
      a.post(`/api/items/${item.id}/claims`).send({ answer: "It has a wooden handle" }),
    ]);
    assert.deepEqual([s1.status, s2.status].sort(), [200, 201]);
    assert.equal(s1.body.claim.id, s2.body.claim.id);
    const claimB = await b.post(`/api/items/${item.id}/claims`).send({ answer: "Mine has a hook" }).expect(201);

    // Two different claims accepted concurrently: exactly one wins.
    const results = await Promise.all([
      reporter.post(`/api/claims/${s1.body.claim.id}/accept`),
      reporter.post(`/api/claims/${claimB.body.claim.id}/accept`),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM claims WHERE item_id = $1 AND status = 'accepted'", [item.id]);
    assert.equal(rows[0].n, 1);

    // Repeating the winning accept is idempotent.
    const winner = results.find((r) => r.status === 200).body.claim.id;
    const again = await reporter.post(`/api/claims/${winner}/accept`).expect(200);
    assert.equal(again.body.changed, false);

    // Marking returned supersedes the losing pending claim.
    await reporter.post(`/api/items/${item.id}/status`).send({ status: "returned" }).expect(200);
    const statuses = (await ctx.pool.query("SELECT status FROM claims WHERE item_id = $1 ORDER BY id", [item.id])).rows.map((r) => r.status);
    assert.deepEqual(statuses.sort(), ["accepted", "superseded"]);
  });

  test("message retries with the same clientId create one message and one notification", async () => {
    const reporter = await ctx.agent({ email: "dedupe-r@example.com" });
    const item = await createItem(reporter, { title: "Silver ring", category: "jewelry" });
    const other = await ctx.agent({ email: "dedupe-o@example.com" });
    const conv = await other.post(`/api/items/${item.id}/conversations`).send({}).expect(201);
    const clientId = crypto.randomUUID();
    const sends = await Promise.all(
      [1, 2, 3].map(() => other.post(`/api/conversations/${conv.body.conversationId}/messages`).send({ body: "I found a ring like this", clientId }))
    );
    assert.ok(sends.every((r) => r.status === 201));
    assert.equal(new Set(sends.map((r) => r.body.message.id)).size, 1);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'message'", [reporter.user.id]);
    assert.equal(rows[0].n, 1);
  });
});

describe("matching", () => {
  test("a new found listing notifies the owner of a similar lost listing once", async () => {
    const loser = await ctx.agent({ email: "loser@example.com" });
    const lost = await createItem(loser, { type: "lost", title: "Samsung Galaxy S23 phone", category: "phone", location: "FC Road Pune" });
    const finder = await ctx.agent({ email: "matchfinder@example.com" });
    const found = await createItem(finder, { type: "found", title: "Samsung Galaxy phone", category: "phone", location: "FC Road" });
    // Editing the found listing re-runs matching; dedupe keeps one notification.
    await finder.patch(`/api/items/${found.id}`).field("description", "Black case").expect(200);

    const matches = await ctx.pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'match'", [loser.user.id]);
    assert.equal(matches.rows[0].n, 1);
    const list = await loser.get(`/api/items/${lost.id}/matches`).expect(200);
    assert.equal(list.body.matches[0].item.id, found.id);
  });
});

describe("moderation", () => {
  test("report, remove and restore with audit trail and public effect", async () => {
    const owner = await ctx.agent({ email: "spammer@example.com" });
    const item = await createItem(owner, { title: "Cheap watches for sale", category: "other" }, [await pngImage()]);
    const reporter = await ctx.agent({ email: "flagger@example.com" });
    await reporter.post(`/api/items/${item.id}/reports`).send({ reason: "spam", details: "Advert" }).expect(201);
    const again = await reporter.post(`/api/items/${item.id}/reports`).send({ reason: "spam" }).expect(200);
    assert.equal(again.body.alreadyReported, true);

    const mod = await ctx.agent({ email: "mod@example.com", role: "moderator" });
    const queue = await mod.get("/api/moderation/queue").expect(200);
    assert.ok(queue.body.entries.some((e) => e.item.id === item.id && e.reports.length === 1));

    await mod.post(`/api/moderation/items/${item.id}/remove`).send({ reason: "Commercial spam" }).expect(200);
    const anon = ctx.anonymous();
    assert.equal((await anon.get(`/api/items/${item.id}`)).status, 410);
    assert.equal((await anon.get(item.images[0].url)).status, 404);
    assert.equal((await anon.get("/api/items?q=watches")).body.total, 0);
    // Owner and moderator can still see it.
    assert.equal((await owner.get(`/api/items/${item.id}`)).body.item.moderationState, "removed");
    assert.equal((await owner.get(item.images[0].url)).status, 200);
    assert.ok((await owner.get("/api/notifications")).body.notifications.some((n) => n.type === "listing_removed"));

    const actions = await mod.get("/api/moderation/actions").expect(200);
    assert.ok(actions.body.actions.some((a) => a.itemId === item.id && a.action === "remove_listing" && a.reason === "Commercial spam"));

    await mod.post(`/api/moderation/items/${item.id}/restore`).send({ reason: "Appeal accepted" }).expect(200);
    assert.equal((await anon.get(`/api/items/${item.id}`)).status, 200);
  });
});
