import { test, expect } from "@playwright/test";

// Real end-to-end Gemini Live conversation for /explore. Needs a GEMINI_API_KEY
// the emulator can read and spends a few cents, so it only runs on demand:
//   E2E_LIVE=1 npm run test:e2e
// Chromium's fake microphone stands in for the child.
test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 to run the real Gemini Live conversation");
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("exlive"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Live Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("the companion greets the child by name in a live voice session", async ({ page }) => {
  test.setTimeout(120_000);
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Hadi");
  await page.getByLabel("Strengths").fill("loves space and rockets");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hadi")).toBeVisible();

  // Explore lives behind the GAMES dropdown in the nav.
  await page.locator("header.nav").getByRole("button", { name: "Games" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.locator(".ex-buddy")).toBeVisible({ timeout: 30_000 });
  // Gemini's spoken greeting is captioned (output transcription).
  await expect(page.locator(".ex-captions .guide").first()).toContainText(/Hadi/i, { timeout: 45_000 });
  await page.getByRole("button", { name: "All done" }).click();
  await expect(page.getByText("What a fun chat!")).toBeVisible();
});
