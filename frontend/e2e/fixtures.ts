import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export { expect };

export type Role = { email: string; name: string; role?: "user" | "moderator" | "admin" };

// Unique per run so reruns against the same stack never collide.
export const RUN = Date.now().toString(36);
export const persona = (label: string, role: Role["role"] = "user"): Role => ({
  email: `${label}-${RUN}@e2e.test`,
  name: `${label[0].toUpperCase()}${label.slice(1)} Tester`,
  role,
});

async function csrf(request: APIRequestContext) {
  const res = await request.get("/api/auth/me");
  return (await res.json()).csrfToken as string;
}

// Signs a browser context in through the test-only fixture endpoint (only
// registered when the API runs with NODE_ENV=test and ENABLE_TEST_AUTH=true).
export async function signIn(context: BrowserContext, who: Role) {
  const token = await csrf(context.request);
  const res = await context.request.post("/api/auth/test-login", { headers: { "X-CSRF-Token": token }, data: who });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).user as { id: number };
}

export async function newUser(browser: Browser, who: Role) {
  const context = await browser.newContext();
  const user = await signIn(context, who);
  const page = await context.newPage();
  return { context, page, user };
}

// Authenticated JSON/multipart API helper for a context (adds CSRF).
export async function apiCall(context: BrowserContext, method: string, path: string, options: { data?: unknown; multipart?: Record<string, unknown> } = {}) {
  const token = await csrf(context.request);
  return context.request.fetch(`/api${path}`, { method, headers: { "X-CSRF-Token": token }, ...options } as never);
}

export async function createListing(context: BrowserContext, fields: Record<string, string>) {
  const res = await apiCall(context, "POST", "/items", {
    multipart: { type: "lost", category: "other", location: "Pune", date: new Date().toISOString().slice(0, 10), ...fields },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).item as { id: number; title: string; images: { url: string }[] };
}

// A real PNG for upload tests, produced by the browser itself.
export async function pngFixture(page: Page) {
  await page.setContent('<div style="width:320px;height:240px;background:linear-gradient(45deg,#c00,#06c)"></div>');
  return page.locator("div").screenshot({ type: "png" });
}

// On small screens the language switcher and account actions live in the
// collapsible menu; open it when present.
export async function openMenuIfCollapsed(page: Page) {
  const toggle = page.getByRole("button", { name: "Menu" });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

export const test = base;
