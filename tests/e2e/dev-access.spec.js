import { test, expect } from "@playwright/test";

// Developer access channel (see DEVELOPER_ACCESS.md): on the local emulator
// suite the login page exposes a one-click developer sign-in that grants full
// app access with zero setup. Serial mode: the first test creates the shared
// dev account + family, the second exercises the ?dev=1 auto-flow against it.
test.describe.configure({ mode: "serial" });

test("developer sign-in grants full app access on emulators", async ({ page }) => {
  await page.goto("/login");
  const devBtn = page.getByRole("button", { name: /Developer sign-in/ });
  await expect(devBtn).toBeVisible();
  await devBtn.click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });

  // Session persists across reloads (no repeated sign-in needed).
  await page.reload();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

  // Family-scoped feature pages are reachable with no further setup.
  await page.goto("/phonics");
  await expect(page.locator(".pp-title")).toContainText("Sound Splash");
  await page.goto("/curriculum");
  await expect(page).toHaveURL(/curriculum$/);
});

test("?dev=1 signs in without any clicks", async ({ page }) => {
  await page.goto("/login?dev=1");
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
});
