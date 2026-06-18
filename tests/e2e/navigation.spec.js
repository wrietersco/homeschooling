import { test, expect } from "@playwright/test";

// Functional navigation + route-guard behavior using the real router.
test.describe("navigation & route guards", () => {
  test("Get started CTA routes to /login", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("protected /dashboard redirects a signed-out user to /login with redirect query", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)dashboard$/);
  });

  test("superadmin-only /platform redirects a signed-out user to /login", async ({ page }) => {
    // requiresAuth is evaluated before the role check, so a signed-out visitor
    // lands on login (not home). The non-superadmin→home case needs auth and is
    // covered in the Phase 8 platform tests.
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)platform$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("child player route is public and reads its token", async ({ page }) => {
    await page.goto("/play/demo-token-123");
    await expect(page).toHaveURL(/\/play\/demo-token-123$/);
    await expect(page.getByText("demo-token-123")).toBeVisible();
  });

  test("unknown route shows not-found", async ({ page }) => {
    await page.goto("/this-does-not-exist");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
