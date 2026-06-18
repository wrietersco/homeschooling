import { test, expect } from "@playwright/test";

// Phase 3: the guide agent UI is reachable and the askGuide callable responds.
// The emulator has no GEMINI_API_KEY, so the callable returns its graceful
// "not configured" message — which still proves the full client→callable→
// response wiring works end to end.
test.describe.configure({ mode: "serial" });

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("guide"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Guide Fam");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("ask the guide a question and get a response", async ({ page }) => {
  await registerAndOnboard(page);
  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL(/\/guide$/);

  await page.getByLabel("Your question").fill("Who are my children?");
  await page.getByRole("button", { name: "Send" }).click();

  // The user's message echoes into the thread...
  await expect(page.locator(".msg.user").getByText("Who are my children?")).toBeVisible();
  // ...and the assistant replies (here: the not-configured notice).
  await expect(page.locator(".msg.assistant").getByText(/GEMINI_API_KEY|guide/i)).toBeVisible({ timeout: 15_000 });
});
