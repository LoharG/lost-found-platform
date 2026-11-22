"use strict";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const supertest = require("supertest");
const { resolveIdentity } = require("../src/auth/accounts");
const { setup, pngImage, createItem, storedFiles } = require("./helpers");

let ctx;
before(async () => {
  ctx = await setup();
});
after(async () => ctx.teardown());

function lastCode() {
  const message = ctx.mailer.sent.filter((m) => m.template === "otp").at(-1);
  return message.text.match(/\b(\d{6})\b/)[1];
}

describe("email one-time codes", () => {
  test("request -> verify signs in; the code cannot be replayed", async () => {
    const http = await ctx.agent();
    await http.post("/api/auth/email/request").send({ email: "Otp.User@Example.com" }).expect(202);
    const code = lastCode();
    const ok = await http.post("/api/auth/email/verify").send({ email: "otp.user@example.com", code });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, "otp.user@example.com");

    const replay = await (await ctx.agent()).post("/api/auth/email/verify").send({ email: "otp.user@example.com", code });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error.code, "invalid_code");
  });

  test("concurrent verification of one code signs in at most once", async () => {
    const http = await ctx.agent();
    await http.post("/api/auth/email/request").send({ email: "race-otp@example.com" }).expect(202);
    const code = lastCode();
    const agents = await Promise.all([ctx.agent(), ctx.agent(), ctx.agent()]);
    const results = await Promise.all(agents.map((a) => a.post("/api/auth/email/verify").send({ email: "race-otp@example.com", code })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  test("expired codes and too many wrong attempts fail", async () => {
    const http = await ctx.agent();
    await http.post("/api/auth/email/request").send({ email: "expire@example.com" }).expect(202);
    const code = lastCode();
    await ctx.pool.query("UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE email = 'expire@example.com'");
    assert.equal((await http.post("/api/auth/email/verify").send({ email: "expire@example.com", code })).status, 400);

    await http.post("/api/auth/email/request").send({ email: "brute@example.com" }).expect(202);
    const good = lastCode();
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await http.post("/api/auth/email/verify").send({ email: "brute@example.com", code: wrong });
    assert.equal((await http.post("/api/auth/email/verify").send({ email: "brute@example.com", code: good })).status, 400, "code burned after 5 failures");
  });

  test("a new code invalidates the previous one; per-email request limit applies", async () => {
    const http = await ctx.agent();
    await http.post("/api/auth/email/request").send({ email: "twice@example.com" }).expect(202);
    const first = lastCode();
    await http.post("/api/auth/email/request").send({ email: "twice@example.com" }).expect(202);
    const second = lastCode();
    if (first !== second) assert.equal((await http.post("/api/auth/email/verify").send({ email: "twice@example.com", code: first })).status, 400);
    await http.post("/api/auth/email/request").send({ email: "twice@example.com" }).expect(202);
    assert.equal((await http.post("/api/auth/email/request").send({ email: "twice@example.com" })).status, 429);
  });

  test("Google is reported unconfigured and its route redirects to a clear message", async () => {
    const providers = await ctx.anonymous().get("/api/auth/providers").expect(200);
    assert.equal(providers.body.google, false);
    const res = await ctx.anonymous().get("/api/auth/google");
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/login\?error=google_unconfigured$/);
  });
});

describe("account linking", () => {
  test("verified email from another provider links to the same account", async () => {
    const viaEmail = await resolveIdentity(ctx.pool, { provider: "email", subject: "link@example.com", email: "link@example.com", emailVerified: true });
    const viaGoogle = await resolveIdentity(ctx.pool, {
      provider: "google",
      subject: "google-sub-123",
      email: "LINK@example.com",
      emailVerified: true,
      name: "Link Person",
    });
    assert.equal(viaGoogle.id, viaEmail.id);
  });

  test("an unverified email never links to an existing account", async () => {
    const victim = await resolveIdentity(ctx.pool, { provider: "email", subject: "victim@example.com", email: "victim@example.com", emailVerified: true });
    const attacker = await resolveIdentity(ctx.pool, { provider: "google", subject: "attacker-sub", email: "victim@example.com", emailVerified: false });
    assert.notEqual(attacker.id, victim.id);
  });
});

describe("profile, export and deletion", () => {
  test("international phone numbers are validated and normalized", async () => {
    const http = await ctx.agent({ email: "phone@example.com" });
    assert.equal((await http.patch("/api/account/profile").send({ phone: "12345", phoneCountry: "IN" })).status, 400);
    const us = await http.patch("/api/account/profile").send({ phone: "(415) 555-2671", phoneCountry: "US" }).expect(200);
    assert.equal(us.body.user.phone, "+14155552671");
    const cleared = await http.patch("/api/account/profile").send({ phone: null }).expect(200);
    assert.equal(cleared.body.user.phone, null);
  });

  test("export contains the user's data; deletion removes it and its images", async () => {
    const http = await ctx.agent({ email: "leaving@example.com", name: "Leaving User" });
    const item = await createItem(http, { title: "Leaving bag", category: "bag" }, [await pngImage()]);
    const other = await ctx.agent({ email: "stays@example.com" });
    const otherItem = await createItem(other, { type: "found", title: "Found hat", category: "clothing" });
    await http.post(`/api/items/${otherItem.id}/claims`).send({ answer: "Blue hat" }).expect(201);

    const exported = await http.get("/api/account/export").expect(200);
    assert.match(exported.headers["content-disposition"], /attachment/);
    assert.equal(exported.body.account.email, "leaving@example.com");
    assert.equal(exported.body.listings.length, 1);
    assert.equal(exported.body.claimsSubmitted[0].answer, "Blue hat");

    const filesBefore = storedFiles(ctx.storageDir).length;
    assert.equal((await http.delete("/api/account").send({ confirm: "nope" })).status, 400);
    await http.delete("/api/account").send({ confirm: "DELETE" }).expect(204);

    assert.equal(storedFiles(ctx.storageDir).length, filesBefore - 2);
    assert.equal((await ctx.anonymous().get(`/api/items/${item.id}`)).status, 404);
    assert.equal((await ctx.pool.query("SELECT count(*)::int AS n FROM users WHERE email = 'leaving@example.com'")).rows[0].n, 0);
    assert.equal((await ctx.pool.query("SELECT count(*)::int AS n FROM claims WHERE item_id = $1", [otherItem.id])).rows[0].n, 0);
    assert.equal((await http.get("/api/auth/me")).body.loggedIn, false);
  });
});

describe("sessions survive an API restart", () => {
  test("a new app instance on the same database accepts the existing session", async () => {
    const http = await ctx.agent({ email: "restart@example.com" });
    const cookie = (await http.get("/api/auth/me")).request.cookies;
    // Build a second app (simulating a restarted process) on the same pool.
    const { createApp } = require("../src/app");
    const { createLogger } = require("../src/logger");
    const app2 = createApp({ config: ctx.config, pool: ctx.pool, logger: createLogger(ctx.config), storage: ctx.storage, mailer: ctx.mailer });
    const me = await supertest(app2).get("/api/auth/me").set("Cookie", cookie).expect(200);
    assert.equal(me.body.loggedIn, true);
    assert.equal(me.body.user.email, "restart@example.com");
    assert.ok(fs.existsSync(ctx.storageDir));
  });
});
