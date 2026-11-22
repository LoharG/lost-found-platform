import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = (o) => fs.writeFileSync("/tmp/claude-501/otp-result.json", JSON.stringify(o, null, 1));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
try {
  await p.goto("http://localhost:3000/login?next=/report");
  await p.getByLabel("Email address").fill("ganeshml15@gmail.com");
  const respP = p.waitForResponse((r) => r.url().endsWith("/api/auth/email/request"));
  await p.getByRole("button", { name: "Email me a code" }).click();
  const resp = await respP;
  const body = await resp.json();
  await p.getByTestId("otp-recipient").waitFor();
  await p.screenshot({ path: "/tmp/claude-501/otp-shots/2-code-entry.png" });
  out({ stage: "waiting_for_code", requestStatus: resp.status(), delivery: body.delivery, challengePrefix: String(body.challengeId).slice(0, 8), requestedAt: new Date().toISOString() });
  let code = null;
  for (let i = 0; i < 300 && !code; i++) {
    if (fs.existsSync("/tmp/claude-501/otp-code.txt")) code = fs.readFileSync("/tmp/claude-501/otp-code.txt", "utf8").trim();
    else await p.waitForTimeout(1000);
  }
  fs.rmSync("/tmp/claude-501/otp-code.txt", { force: true });
  if (!code) throw new Error("no code provided within 5 minutes");
  const verifyP = p.waitForResponse((r) => r.url().endsWith("/api/auth/email/verify"));
  await p.getByLabel("6-digit code").pressSequentially(code, { delay: 40 }); // auto-submits at 6 digits
  code = null;
  const v = await verifyP;
  const vb = await v.json();
  await p.waitForURL("**/report", { timeout: 20000 });
  await p.screenshot({ path: "/tmp/claude-501/otp-shots/3-signed-in-report.png" });
  // Protected action: publish a listing while signed in.
  await p.getByLabel("What is it?").fill("OTP sign-in check: black umbrella");
  await p.locator("label", { hasText: "I found something" }).click();
  await p.getByLabel("Category", { exact: true }).selectOption("other");
  await p.getByLabel("Where?").fill("Pune station");
  await p.getByRole("button", { name: "Publish listing" }).click();
  await p.waitForURL(/\/items\/\d+$/, { timeout: 20000 });
  await p.screenshot({ path: "/tmp/claude-501/otp-shots/4-protected-action.png" });
  const me = await (await ctx.request.get("http://localhost:3000/api/auth/me")).json();
  out({ stage: "done", verifyStatus: v.status(), redirectTo: vb.redirectTo, emailVerified: vb.user?.emailVerified, signedInAs: me.user?.email, listingUrl: p.url().replace("http://localhost:3000", "") });
} catch (e) {
  await p.screenshot({ path: "/tmp/claude-501/otp-shots/error.png" }).catch(() => {});
  out({ stage: "error", error: e.message.slice(0, 300) });
} finally {
  await b.close();
}
