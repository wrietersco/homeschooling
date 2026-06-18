import { test, expect } from "@playwright/test";

// Phase 6: planner page is reachable, shows correct empty states, week
// navigation works, and the route is auth-guarded.
test.describe.configure({ mode: "serial" });

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("planner"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Planner Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("planner page is reachable via nav and shows heading", async ({ page }) => {
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Planner" }).click();
  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByRole("heading", { name: "Activity Planner" })).toBeVisible();
});

test("planner shows week navigation controls and empty activity pool", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/planner");
  // Week nav
  await expect(page.getByRole("button", { name: /Prev/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Next/i })).toBeVisible();
  // Empty pool message
  await expect(page.getByText(/No activities yet/i)).toBeVisible();
  // Link to syllabus
  await expect(page.getByRole("link", { name: /generate a syllabus/i })).toBeVisible();
});

test("week navigation advances and resets the displayed week", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/planner");
  const label = await page.locator(".week-label").textContent();
  await page.getByRole("button", { name: /Next/i }).click();
  const nextLabel = await page.locator(".week-label").textContent();
  expect(nextLabel).not.toEqual(label);
  await page.getByRole("button", { name: "Today" }).click();
  const resetLabel = await page.locator(".week-label").textContent();
  expect(resetLabel).toEqual(label);
});

test("planner route requires auth — redirects to login when signed out", async ({ page }) => {
  await page.goto("/planner");
  await expect(page).toHaveURL(/\/login/);
});
