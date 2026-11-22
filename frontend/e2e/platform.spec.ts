import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { createListing, expect, newUser, persona, RUN, signIn, test } from "./fixtures";

// ---------------------------------------------------------------------------
// 7. Logout and session persistence across an API restart
// ---------------------------------------------------------------------------
test("logout ends the session; sessions survive an API restart", async ({ browser }) => {
  const { context, page } = await newUser(browser, persona("session"));
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();

  if (process.env.E2E_COMPOSE_PROJECT !== "none") {
    execSync(`docker compose -p ${process.env.E2E_COMPOSE_PROJECT || "lftest"} restart backend`, { cwd: "..", stdio: "ignore" });
    await expect
      .poll(async () => (await context.request.get("/api/auth/me").catch(() => null))?.status() ?? 0, { timeout: 60_000 })
      .toBe(200);
    expect((await (await context.request.get("/api/auth/me")).json()).loggedIn).toBe(true);
  }

  await page.reload();
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL("/");
  expect((await (await context.request.get("/api/auth/me")).json()).loggedIn).toBe(false);
  await page.goto("/account");
  await expect(page.getByText("Sign in to see your account.")).toBeVisible();
  await context.close();
});

test("login page explains provider availability and email codes are wired up", async ({ page }) => {
  await page.goto("/login?error=oauth_failed");
  await expect(page.getByText("Sign-in was cancelled or failed")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.goto("/login?error=google_unconfigured");
  await expect(page.getByText(/Google sign-in isn't set up/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 8. Responsive layout, accessibility, keyboard navigation
// ---------------------------------------------------------------------------
const PAGES = ["/", "/items?type=lost", "/login", "/privacy"];

for (const path of PAGES) {
  test(`no serious accessibility violations on ${path} @responsive`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  });
}

test("signed-in pages pass accessibility checks @responsive", async ({ browser }) => {
  const { context, page } = await newUser(browser, persona("a11y"));
  const item = await createListing(context, { title: `A11y keys ${RUN}`, category: "keys", type: "found" });
  for (const path of ["/report", "/account", `/items/${item.id}`, "/notifications", "/inbox"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  }
  await context.close();
});

test("mobile navigation menu opens, traps nothing, and closes with Escape @mobile-only", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Found items" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Lost items" }).click();
  await expect(page).toHaveURL(/type=lost/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // No horizontal scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keyboard-only: skip link, search, report form and contact", async ({ browser, page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  // Search via keyboard.
  await page.getByLabel("Search listings").focus();
  await page.keyboard.type("umbrella");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/items\?q=umbrella/);

  // Report form entirely by keyboard.
  const context = page.context();
  await signIn(context, persona("keyboard"));
  await page.goto("/report");
  await page.getByLabel("I lost something").focus();
  await page.keyboard.press("ArrowDown"); // radio group -> found
  await expect(page.getByLabel("I found something")).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.type(`Keyboard phone ${RUN}`);
  await page.keyboard.press("Tab"); // category
  await page.keyboard.press("Tab"); // date
  await page.keyboard.press("Tab"); // location
  await page.keyboard.type("Deccan Gymkhana");
  await page.getByLabel("Category").selectOption("phone");
  await page.getByRole("button", { name: "Publish listing" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/items\/\d+$/);

  // Submitting with errors moves focus to the error summary.
  await page.goto("/report");
  await page.getByRole("button", { name: "Publish listing" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
  await expect(page.locator("[tabindex='-1']").filter({ hasText: "Please fix the highlighted fields." })).toBeFocused();

  // Contact via keyboard from another account.
  const other = await newUser(browser, persona("kb-contact"));
  const target = await createListing(other.context, { title: `Keyboard target ${RUN}`, category: "keys" });
  await page.goto(`/items/${target.id}`);
  await page.getByLabel("Send a private message").focus();
  await page.keyboard.type("Is this still available?");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/inbox\/\d+$/);
  await expect(page.getByText("Is this still available?")).toBeVisible();
  await other.context.close();
});

test("main journeys render on mobile without overflow @responsive", async ({ browser }) => {
  const { context, page } = await newUser(browser, persona("mobile"));
  const item = await createListing(context, { title: `Mobile layout bag ${RUN}`, category: "bag" });
  for (const path of ["/", "/items?type=lost", `/items/${item.id}`, "/report", "/account"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await context.close();
});
