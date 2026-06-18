import { test, expect } from "@playwright/test";

// Phase 7: Activity Player — parent detail view (auth-gated) and child player
// (public, token-scoped). Tests cover routing, auth guards, and graceful
// error handling for invalid / expired tokens.
test.describe.configure({ mode: "serial" });

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("player"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Player Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("activity route requires auth — redirects to login when signed out", async ({ page }) => {
  await page.goto("/activity/some-activity-id");
  await expect(page).toHaveURL(/\/login/);
});

test("activity view shows 'not found' for a missing activity ID when signed in", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/activity/definitely-does-not-exist");
  await expect(page.getByText(/Activity not found/i)).toBeVisible({ timeout: 10_000 });
});

test("child player shows error state for a malformed token", async ({ page }) => {
  // Token with no dot separator — invalid format
  await page.goto("/play/bad-token-no-dot");
  await expect(page).toHaveURL(/\/play\/bad-token-no-dot$/);
  // Should show error text and the raw token value (navigation test coverage)
  await expect(page.getByText("bad-token-no-dot")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(/invalid/i)).toBeVisible();
});

test("child player shows error state for a valid-format but non-existent token", async ({ page }) => {
  // Compound format: familyId.tokenId — looks right but doesn't exist in Firestore
  await page.goto("/play/fakefamily123.00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/play\//);
  await expect(
    page.getByText(/expired|no longer valid|could not load/i)
  ).toBeVisible({ timeout: 8_000 });
});
