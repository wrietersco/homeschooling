import { test, expect } from "@playwright/test";

// Wikido deep links — every place is addressable:
//   /wikido/:topicId/:sceneId?card=<spotId>&at=lat,lng,zoom&intro=0|1
// A shared link lands on the same scene and card (even through the in-place
// sign-in gate), Back/Forward walk the scene history, and stale links land on
// the nearest valid place with a friendly notice.

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signUpThroughGate(page) {
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Link Wanderer");
  await gate.getByLabel("Email").fill(uniqueEmail("deeplink"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();
}

test("a deep link survives the sign-in gate and lands on the scene with its card open", async ({ page }) => {
  await page.goto("/wikido/living-things/kinds-of-living-things?card=animals");
  await signUpThroughGate(page);
  // still on the same address, on that scene, with that card open
  await expect(page).toHaveURL(/\/wikido\/living-things\/kinds-of-living-things\?card=animals$/);
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
  await expect(page.locator(".wd-info")).toBeVisible();
  // the trail back up is rebuilt from the scene's natural ancestors
  await expect(page.locator(".wd-crumb", { hasText: "Living Things" }).first()).toBeVisible();
});

test("every navigation updates the URL and Back/Forward walk the scene history", async ({ page }) => {
  await page.goto("/wikido");
  await signUpThroughGate(page);
  await expect(page.locator(".wd-shelf-title")).toBeVisible();

  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page).toHaveURL(/\/wikido\/living-things$/);

  await page.getByRole("button", { name: /Kinds of Living Things/ }).click();
  await expect(page).toHaveURL(/\?card=kinds$/);
  await page.locator(".wd-enter").click();
  await expect(page).toHaveURL(/\/wikido\/living-things\/kinds-of-living-things$/);

  await page.getByRole("button", { name: /^Animals/ }).dblclick();
  await expect(page).toHaveURL(/\/wikido\/living-things\/types-of-animals/);
  await expect(page.locator(".wd-crumb.current")).toHaveText("Types of Animals");

  // (the double-tap's first tap opened the Animals card — that is a history step too)
  await page.goBack();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".wd-info")).toHaveCount(0);
  await page.goBack(); // back out of the scene lands on the world with the doorway's card still open
  await expect(page.locator(".wd-crumb.current")).toHaveText("Living Things");
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");

  // opening and closing a card are history steps too: Back closes the card
  await page.getByRole("button", { name: /Sorting All of Life/ }).click();
  await expect(page).toHaveURL(/\?card=sorting-life$/);
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".wd-info")).toHaveCount(0);

  // home returns to the bare shelf URL
  await page.locator(".wd-home").click();
  await expect(page).toHaveURL(/\/wikido$/);
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
});

test("outdated links land on the nearest valid place with a friendly notice", async ({ page }) => {
  await page.goto("/wikido");
  await signUpThroughGate(page);
  await expect(page.locator(".wd-shelf-title")).toBeVisible();

  // unknown card → the scene, no card
  await page.goto("/wikido/living-things/kinds-of-living-things?card=ghost");
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
  await expect(page.locator(".wd-toast")).toContainText(/card/);
  await expect(page.locator(".wd-info")).toHaveCount(0);
  await expect(page).toHaveURL(/\/wikido\/living-things\/kinds-of-living-things$/);

  // unknown scene → the world's root
  await page.goto("/wikido/living-things/no-such-scene");
  await expect(page.locator(".wd-crumb.current")).toHaveText("Living Things");
  await expect(page.locator(".wd-toast")).toContainText(/isn't open any more/);
  await expect(page).toHaveURL(/\/wikido\/living-things$/);

  // unknown world → the shelf
  await page.goto("/wikido/no-such-world");
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
  await expect(page.locator(".wd-toast")).toBeVisible();
  await expect(page).toHaveURL(/\/wikido$/);
});

test("Copy link puts the scene's deep link on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/wikido/living-things/kinds-of-living-things");
  await signUpThroughGate(page);
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
  await page.getByRole("button", { name: "Copy link to this place" }).click();
  await expect(page.locator(".wd-toast")).toHaveText("Link copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/wikido\/living-things\/kinds-of-living-things$/);

  await page.getByRole("button", { name: /^Animals/ }).click();
  await page.getByRole("button", { name: "Copy link to this card" }).click();
  const withCard = await page.evaluate(() => navigator.clipboard.readText());
  expect(withCard).toMatch(/\/kinds-of-living-things\?card=animals$/);
});
