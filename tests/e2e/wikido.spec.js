import { test, expect } from "@playwright/test";

// Wikido (/wikido) — immersive picture encyclopedia. Covers the auth guard, the
// Games-menu entry, the topic shelf, hotspot exploration, and the drill-down
// breadcrumb trail (Civilizations → Persian Empire).

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("wikido"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Wikido Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("wikido route requires auth — redirects to login when signed out", async ({ page }) => {
  await page.goto("/wikido");
  await expect(page).toHaveURL(/\/login/);
});

test("shelf opens from the Games menu and hides the app nav (immersive)", async ({ page }) => {
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("button", { name: "Games" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Wikido" }).click();
  await expect(page).toHaveURL(/\/wikido$/);
  // immersive route: the app nav is gone, the Wikido shelf is up
  await expect(page.locator("header.nav")).toHaveCount(0);
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");
  await expect(page.locator(".wd-topic")).toHaveCount(1);
});

test("child explores the Civilizations topic and drills into the Persian Empire", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic").click();
  await expect(page.locator(".wd-title")).toHaveText("Civilizations");

  // every hotspot of the overview scene is on screen
  await expect(page.locator(".wd-hot")).toHaveCount(5);

  // a leaf hotspot opens its info card (no "Step inside")
  await page.getByRole("button", { name: /What is a Civilization/ }).click();
  const card = page.locator(".wd-info");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Fun fact!");
  await expect(card.locator(".wd-enter")).toHaveCount(0);
  await card.locator(".wd-close").click();
  await expect(card).toHaveCount(0);

  // the "Great Empires" hotspot steps into the Persian Empire scene
  await page.getByRole("button", { name: /Great Empires/ }).click();
  await page.locator(".wd-enter").click();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Persian Empire & Persepolis");
  await expect(page.locator(".wd-hot")).toHaveCount(5);

  // a double-click on a doorway hotspot steps straight in (no info card stop)
  await page.getByRole("button", { name: /Apadana Palace/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Apadana Palace");
  await expect(page.locator(".wd-hot")).toHaveCount(3);
  // drill to the very bottom, then use the breadcrumb to come back
  await page.getByRole("button", { name: /Bull Capitals/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Bull Capitals");
  await page.locator(".wd-crumb", { hasText: "Civilizations" }).first().click();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Civilizations");
  // leaving via home returns to the shelf
  await page.locator(".wd-home").click();
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
});

test("discovery progress survives a reload", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic").click();
  await page.getByRole("button", { name: /What is a Civilization/ }).click();
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.reload();
  await page.locator(".wd-topic").click();
  await expect(page.locator(".wd-progress")).toContainText("1/");
  await expect(page.locator(".wd-hot.seen")).toHaveCount(1);
});

test("shows the big-screen notice on a phone-sized viewport", async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 900 } });
  const small = await context.newPage();
  await small.goto("/login");
  // reuse a fresh registration on the small viewport
  await small.getByRole("button", { name: "Create an account" }).click();
  await small.getByLabel("Email").fill(uniqueEmail("wikido.small"));
  await small.getByLabel("Password").fill("test123456");
  await small.getByRole("button", { name: "Create account" }).click();
  await small.getByLabel("Family name").fill("Wikido Small");
  await small.getByRole("button", { name: "Create family" }).click();
  await expect(small).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await small.goto("/wikido");
  await expect(small.locator(".wd-desktop-note")).toBeVisible();
  await context.close();
});
