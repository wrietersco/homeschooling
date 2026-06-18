import { test, expect } from "@playwright/test";

// Phase 0 smoke: the app shell renders, the brand + nav are present, and the
// home hero shows. These guard against build/wiring regressions as modules land.
test.describe("app shell", () => {
  test("home page renders hero and nav", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Dar-al-Hikmah OS/);
    await expect(page.getByRole("heading", { name: "Dar-al-Hikmah OS" })).toBeVisible();
    await expect(page.getByText(/homeschooling operations hub/i)).toBeVisible();
    // Signed-out nav: Home + Sign in, no Dashboard/Platform.
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Platform" })).toHaveCount(0);
  });

  test("no uncaught console errors on load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});
