import { apiCall, createListing, expect, newUser, openMenuIfCollapsed, persona, pngFixture, RUN, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// 1. Browse, search beyond page 1, filters, pagination, direct link
// ---------------------------------------------------------------------------
test("visitor finds a listing beyond the first page with search, filters and pagination", async ({ browser, page }) => {
  const seeder = await newUser(browser, persona("seeder"));
  const marker = `Compass${RUN}`;
  const oldest = await createListing(seeder.context, {
    title: `Vintage brass ${marker}`,
    category: "other",
    location: "Shaniwar Wada",
    date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10),
  });
  for (let i = 0; i < 24; i++) {
    await createListing(seeder.context, { title: `Umbrella ${RUN} ${i}`, category: i % 2 ? "bag" : "other", location: i % 3 ? "Koregaon Park" : "Hinjewadi" });
  }

  await page.goto("/items?type=lost");
  await expect(page.getByRole("heading", { level: 1, name: "Lost items" })).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(12);
  await expect(page.getByText(marker)).toHaveCount(0);

  // Paginate to the last page: the oldest listing is there.
  const pager = page.getByRole("navigation", { name: "Pagination" });
  await expect(pager).toBeVisible();
  const totalText = await pager.getByText(/Page 1 of \d+/).innerText();
  const totalPages = Number(totalText.match(/of (\d+)/)![1]);
  for (let n = 2; n <= totalPages && (await page.getByText(marker).count()) === 0; n++) {
    await pager.getByRole("link", { name: "Next" }).click();
    await expect(pager.getByText(`Page ${n} of ${totalPages}`)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: new RegExp(marker) })).toBeVisible();

  // Keyword search from page 1 finds it directly.
  await page.goto("/items?type=lost");
  await page.getByLabel("Keyword").fill(marker);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${marker}`));
  await expect(page.getByText("1 listing")).toBeVisible();

  // Filters are reflected in a shareable URL.
  await page.goto("/items?type=lost");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Bag", exact: true }).click(); // chip applies immediately
  await expect(page).toHaveURL(/category=bag/);
  await expect(page.getByRole("button", { name: "Bag", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Location contains").fill("Koregaon");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/category=bag/);
  await expect(page).toHaveURL(/location=Koregaon/);
  const cards = page.locator("main article");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const text of await cards.allInnerTexts()) expect(text).toMatch(/Koregaon/);

  // Direct link renders on the server with share metadata.
  const res = await page.goto(`/items/${oldest.id}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(marker) })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(marker));

  // Invalid URL filters fall back gracefully.
  await page.goto("/items?type=lost&from=2026-02-30");
  await expect(page.getByText("Some filters are invalid")).toBeVisible();
  await seeder.context.close();
});

// ---------------------------------------------------------------------------
// 2. Reporter creates (with images), finds, edits, refreshes
// ---------------------------------------------------------------------------
test("reporter creates a listing with photos, finds it, edits it and sees changes after refresh", async ({ browser }) => {
  const { context, page } = await newUser(browser, persona("reporter"));
  const png = await pngFixture(page);
  const title = `Grey Wildcraft backpack ${RUN}`;

  await page.goto("/report?type=found");
  await page.getByLabel("I found something").check();
  await page.getByLabel("What is it?").fill(title);
  await page.getByLabel("Category").selectOption("bag");
  await page.getByLabel("Where?").fill("Baner Road bus stop");
  await page.getByLabel("Description").fill("Grey with a laptop sleeve");
  await page.getByLabel("Ownership question (optional)").fill("What brand is the water bottle inside?");
  await page.getByTestId("photo-input").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: png },
    { name: "two.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByRole("button", { name: /Remove photo/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Publish listing" }).click();

  await expect(page).toHaveURL(/\/items\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: /Photo 2 of 2/ })).toBeVisible();
  const imgSrc = await page.locator("main img").first().getAttribute("src");
  const img = await context.request.get(imgSrc!);
  expect(img.headers()["content-type"]).toBe("image/webp");
  const itemUrl = page.url();

  // Discoverable by search.
  await page.goto(`/items?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();

  // Edit and refresh.
  await page.goto(itemUrl);
  await page.getByRole("link", { name: "Edit listing" }).click();
  await page.getByLabel("What is it?").fill(`${title} (edited)`);
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${title} (edited)` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `${title} (edited)` })).toBeVisible();
  await expect(page.getByRole("button", { name: /Photo \d of/ })).toHaveCount(0); // one photo left => no thumbnails strip
  await context.close();
});

// ---------------------------------------------------------------------------
// 3 + 4. Contact, claim, notification, accept, return; third-user isolation
// ---------------------------------------------------------------------------
test("claimant contacts and claims; reporter accepts and marks returned; outsiders are locked out", async ({ browser }) => {
  const reporter = await newUser(browser, persona("finder"));
  await apiCall(reporter.context, "PATCH", "/account/profile", { data: { phone: "+91 98765 43210" } });
  const item = await createListing(reporter.context, {
    type: "found",
    title: `Brown leather wallet ${RUN}`,
    category: "wallet",
    ownershipQuestion: "Which card is in the front slot?",
    location: "FC Road",
  });

  const owner = await newUser(browser, persona("owner"));
  await owner.page.goto(`/items/${item.id}`);
  await owner.page.getByLabel("Send a private message").fill("Hi! I lost this near FC Road yesterday.");
  await owner.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(owner.page).toHaveURL(/\/inbox\/\d+$/);
  const conversationId = owner.page.url().split("/").pop();
  await expect(owner.page.getByText("Hi! I lost this near FC Road yesterday.")).toBeVisible();

  await owner.page.goto(`/items/${item.id}`);
  await expect(owner.page.getByText("Which card is in the front slot?")).toBeVisible();
  await owner.page.getByLabel("Your answer (only the poster sees it)").fill("My college library card");
  await owner.page.getByRole("button", { name: "This is mine" }).click();
  await expect(owner.page.getByText("Claim sent. The poster has been notified.")).toBeVisible();

  // Reporter is notified.
  await reporter.page.goto("/notifications");
  await expect(reporter.page.getByRole("link", { name: new RegExp(`New claim on “Brown leather wallet ${RUN}”`) })).toBeVisible();
  await expect(reporter.page.getByRole("link", { name: new RegExp(`New message about “Brown leather wallet ${RUN}”`) })).toBeVisible();

  // Third user cannot read the conversation, claims, edit, or moderate.
  const outsider = await newUser(browser, persona("outsider"));
  expect((await outsider.context.request.get(`/api/conversations/${conversationId}`)).status()).toBe(404);
  expect((await (await outsider.context.request.get(`/api/items/${item.id}/claims`)).json()).claims).toHaveLength(0);
  expect((await apiCall(outsider.context, "PATCH", `/items/${item.id}`, { multipart: { title: "hacked" } })).status()).toBe(403);
  expect((await apiCall(outsider.context, "POST", `/items/${item.id}/status`, { data: { status: "closed" } })).status()).toBe(403);
  expect((await outsider.context.request.get("/api/moderation/queue")).status()).toBe(403);
  await outsider.page.goto(`/inbox/${conversationId}`);
  await expect(outsider.page.getByText("Conversation not found.")).toBeVisible();
  await outsider.page.goto("/moderation");
  await expect(outsider.page.getByText("You need moderator access")).toBeVisible();

  // Public API + rendered page contain no private fields.
  const anon = await browser.newContext();
  const publicJson = await (await anon.request.get(`/api/items/${item.id}`)).text();
  for (const secret of ["@e2e.test", "98765", "library card", '"latitude"', "user_email", "mobile"]) expect(publicJson).not.toContain(secret);
  const anonPage = await anon.newPage();
  await anonPage.goto(`/items/${item.id}`);
  const html = await anonPage.content();
  for (const secret of ["@e2e.test", "98765", "library card"]) expect(html).not.toContain(secret);
  await expect(anonPage.getByText("Sign in to contact the poster")).toBeVisible();

  // Reporter reviews the claim, accepts, marks returned.
  await reporter.page.goto(`/items/${item.id}`);
  await expect(reporter.page.getByText("My college library card")).toBeVisible();
  await reporter.page.getByRole("button", { name: "Accept" }).click();
  await expect(reporter.page.getByText("Claim accepted").first()).toBeVisible();
  await reporter.page.getByRole("button", { name: "Mark as returned" }).click();
  await expect(reporter.page.getByText("Returned").first()).toBeVisible();

  await anonPage.reload();
  await expect(anonPage.getByText("Returned").first()).toBeVisible();
  await anonPage.goto(`/items?q=${encodeURIComponent(`Brown leather wallet ${RUN}`)}`);
  await expect(anonPage.getByText("No listings match")).toBeVisible();

  // Claimant sees accepted + returned notifications; phone sharing is opt-in.
  await owner.page.goto("/notifications");
  await expect(owner.page.getByText(/was accepted/)).toBeVisible();
  await expect(owner.page.getByText(/was marked returned/)).toBeVisible();
  await owner.page.goto(`/inbox/${conversationId}`);
  await expect(owner.page.getByText(/phone:/)).toHaveCount(0);
  await reporter.page.goto(`/inbox/${conversationId}`);
  await reporter.page.getByLabel("Share my phone number in this conversation").check();
  await owner.page.reload();
  await expect(owner.page.getByText("+919876543210")).toBeVisible();

  for (const c of [reporter.context, owner.context, outsider.context, anon]) await c.close();
});

// ---------------------------------------------------------------------------
// 5. Uploads: valid, invalid format, too large, consistency after failure
// ---------------------------------------------------------------------------
test("upload validation gives clear feedback and leaves no partial data", async ({ browser }) => {
  const { context, page } = await newUser(browser, persona("uploader"));
  const before = (await (await context.request.get("/api/me/items")).json()).items.length;

  await page.goto("/report");
  await page.getByLabel("What is it?").fill(`Fake image test ${RUN}`);
  await page.getByLabel("Category").selectOption("other");
  await page.getByLabel("Where?").fill("Aundh");

  // Too large: rejected in the browser before upload.
  await page.getByTestId("photo-input").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(9 * 1024 * 1024, 1) });
  await expect(page.getByText("huge.png is larger than 8 MB.")).toBeVisible();
  // Wrong type by extension/MIME: rejected in the browser.
  await page.getByTestId("photo-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("notes.txt is not a JPEG, PNG or WebP image.")).toBeVisible();
  // Disguised file (HTML named .png): passes the browser check, rejected by the server.
  await page.getByTestId("photo-input").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not a valid JPEG, PNG or WebP/ }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/report/);
  expect((await (await context.request.get("/api/me/items")).json()).items.length).toBe(before);

  // Server-side size limit enforced even if the browser check is bypassed.
  const big = await apiCall(context, "POST", "/items", {
    multipart: { type: "lost", title: "Big", category: "other", location: "Pune", date: new Date().toISOString().slice(0, 10), images: { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(9 * 1024 * 1024, 1) } },
  });
  expect(big.status()).toBe(413);
  expect((await (await context.request.get("/api/me/items")).json()).items.length).toBe(before);

  // Replace with a valid photo: succeeds.
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await page.getByTestId("photo-input").setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: await pngFixture(await context.newPage()) });
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
  expect((await (await context.request.get("/api/me/items")).json()).items.length).toBe(before + 1);
  await context.close();
});

// ---------------------------------------------------------------------------
// 6. Report -> moderator removes -> public search, link and image reflect it
// ---------------------------------------------------------------------------
test("a reported listing removed by a moderator disappears publicly with its image", async ({ browser }) => {
  const poster = await newUser(browser, persona("spammer"));
  const png = await pngFixture(poster.page);
  const res = await apiCall(poster.context, "POST", "/items", {
    multipart: { type: "found", title: `Cheap watches for sale ${RUN}`, category: "other", location: "MG Road", date: new Date().toISOString().slice(0, 10), images: { name: "a.png", mimeType: "image/png", buffer: png } },
  });
  const item = (await res.json()).item;

  const flagger = await newUser(browser, persona("flagger"));
  await flagger.page.goto(`/items/${item.id}`);
  await flagger.page.getByRole("button", { name: "Report listing" }).click();
  await flagger.page.getByLabel("Reason").selectOption("spam");
  await flagger.page.getByLabel("Details (optional)").fill("This is an advert");
  await flagger.page.getByRole("button", { name: "Send report" }).click();
  await expect(flagger.page.getByText("Thanks. A moderator will review it.")).toBeVisible();

  const mod = await newUser(browser, persona("moderator", "moderator"));
  await mod.page.goto("/moderation");
  const entry = mod.page.getByRole("article", { name: `Cheap watches for sale ${RUN}` });
  await expect(entry.getByText("This is an advert")).toBeVisible();
  await entry.getByLabel("Reason for decision (recorded in the audit log)").fill("Commercial spam");
  await entry.getByRole("button", { name: "Remove listing" }).click();
  await expect(mod.page.getByText(`remove listing #${item.id} — Commercial spam`)).toBeVisible();

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`/items/${item.id}`);
  await expect(anonPage.getByRole("heading", { name: "Listing removed" })).toBeVisible();
  expect((await anon.request.get(`/api/items/${item.id}`)).status()).toBe(410);
  expect((await anon.request.get(item.images[0].url)).status()).toBe(404);
  await anonPage.goto(`/items?q=${encodeURIComponent(`Cheap watches for sale ${RUN}`)}`);
  await expect(anonPage.getByText("No listings match")).toBeVisible();

  // Owner still sees it with a notice and gets notified.
  await poster.page.goto(`/items/${item.id}`);
  await expect(poster.page.getByText("A moderator removed this listing")).toBeVisible();
  await poster.page.goto("/notifications");
  await expect(poster.page.getByText(/A moderator removed/)).toBeVisible();
  for (const c of [poster.context, flagger.context, mod.context, anon]) await c.close();
});

// ---------------------------------------------------------------------------
// 9. Concurrency, dedupe and alternate locale
// ---------------------------------------------------------------------------
test("double-submitted claims and messages stay consistent; Hindi locale formats dates", async ({ browser }) => {
  const reporter = await newUser(browser, persona("dup-reporter"));
  const item = await createListing(reporter.context, { type: "found", title: `Black umbrella ${RUN}`, category: "other", date: "2026-03-05" });
  const a = await newUser(browser, persona("dup-a"));
  const b = await newUser(browser, persona("dup-b"));

  const [c1, c2] = await Promise.all([
    apiCall(a.context, "POST", `/items/${item.id}/claims`, { data: { answer: "Wooden handle" } }),
    apiCall(a.context, "POST", `/items/${item.id}/claims`, { data: { answer: "Wooden handle" } }),
  ]);
  expect([c1.status(), c2.status()].sort()).toEqual([200, 201]);
  const claimA = (await c1.json()).claim.id;
  const claimB = (await (await apiCall(b.context, "POST", `/items/${item.id}/claims`, { data: { answer: "Hook handle" } })).json()).claim.id;
  const accepts = await Promise.all([apiCall(reporter.context, "POST", `/claims/${claimA}/accept`), apiCall(reporter.context, "POST", `/claims/${claimB}/accept`)]);
  expect(accepts.map((r) => r.status()).sort()).toEqual([200, 409]);

  const conv = await (await apiCall(a.context, "POST", `/items/${item.id}/conversations`, { data: {} })).json();
  const clientId = crypto.randomUUID();
  await Promise.all([1, 2, 3].map(() => apiCall(a.context, "POST", `/conversations/${conv.conversationId}/messages`, { data: { body: "Same message", clientId } })));
  const view = await (await reporter.context.request.get(`/api/conversations/${conv.conversationId}`)).json();
  expect(view.conversation.messages.filter((m: { body: string }) => m.body === "Same message")).toHaveLength(1);
  const notes = await (await reporter.context.request.get("/api/notifications")).json();
  expect(notes.notifications.filter((n: { type: string; data: { conversationId?: number } }) => n.type === "message" && n.data.conversationId === conv.conversationId)).toHaveLength(1);

  // Hindi
  const page = reporter.page;
  await page.goto(`/items/${item.id}`);
  await openMenuIfCollapsed(page);
  await page.getByLabel("Language").filter({ visible: true }).first().selectOption("hi");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByText("मिलने की तारीख़")).toBeVisible();
  await expect(page.getByText("5 मार्च 2026")).toBeVisible();
  await page.goto("/items?type=found");
  await expect(page.getByRole("heading", { level: 1, name: "मिली चीज़ें" })).toBeVisible();
  const hindiMenu = page.getByRole("button", { name: "मेनू" });
  if ((await hindiMenu.isVisible()) && (await hindiMenu.getAttribute("aria-expanded")) === "false") await hindiMenu.click();
  await page.getByLabel("भाषा").filter({ visible: true }).first().selectOption("en");
  for (const c of [reporter.context, a.context, b.context]) await c.close();
});
