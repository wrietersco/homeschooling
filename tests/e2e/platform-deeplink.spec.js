import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Platform admin deep links: every sidebar section has its own URL
// (/platform/ai-config, /platform/models, …); refresh, Back/Forward and a
// shared link land on the same section; bare /platform still works.

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
if (!getApps().length) initializeApp({ projectId: "homeschooling-b3e57" });

const PASSWORD = "test123456";

async function createSuperadmin() {
  const email = `platlink.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  const user = await getAuth().createUser({ email, password: PASSWORD });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });
  return email;
}

test("a signed-out admin link carries its full path through login (redirect param)", async ({ page }) => {
  await page.goto("/platform/ai-config?x=1");
  await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)platform(%2F|\/)ai-config/);
});

test("sections have their own URLs; refresh and Back/Forward keep them", async ({ page }) => {
  const email = await createSuperadmin();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/onboarding$/, { timeout: 15_000 });
  await page.getByLabel("Family name").fill("Platform Link 2");
  await page.getByRole("button", { name: "Create family" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });

  // bare /platform = Families
  await page.goto("/platform");
  await expect(page.locator("h1")).toHaveText("Families");

  await page.getByRole("button", { name: "Models & pricing" }).click();
  await expect(page).toHaveURL(/\/platform\/models$/);
  await expect(page.locator("h1")).toHaveText("Models & pricing");
  await page.getByRole("button", { name: "Provider capacity" }).click();
  await expect(page).toHaveURL(/\/platform\/capacity$/);

  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Models & pricing");
  await page.reload();
  await expect(page).toHaveURL(/\/platform\/models$/);
  await expect(page.locator("h1")).toHaveText("Models & pricing");
  await page.goForward();
  await expect(page.locator("h1")).toHaveText("Provider capacity");

  // a stale slug settles on the default section
  await page.goto("/platform/no-such-section");
  await expect(page.locator("h1")).toHaveText("Families");
  await expect(page).toHaveURL(/\/platform\/families$/);
});

test("Wikido Studio: world, scene and spot live in the URL, cold open restores them, Open as child links to the child view", async ({ page }) => {
  const email = await createSuperadmin();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/onboarding$/, { timeout: 15_000 });
  await page.getByLabel("Family name").fill("Platform Link 3");
  await page.getByRole("button", { name: "Create family" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });

  await page.goto("/platform/wikido/living-things/kinds-of-living-things?spot=animals");
  await expect(page.locator("h1")).toHaveText("Wikido Studio");
  await expect(page.locator(".grow .pane-title").first()).toContainText("Kinds of Living Things", { timeout: 30_000 });
  await expect(page.locator(".spot.selected")).toBeVisible();
  const open = page.locator(".open-child a");
  await expect(open).toHaveAttribute("href", "/wikido/living-things/kinds-of-living-things?card=animals");

  // and it survives a refresh
  await page.reload();
  await expect(page.locator(".grow .pane-title").first()).toContainText("Kinds of Living Things", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/platform\/wikido\/living-things\/kinds-of-living-things\?spot=animals$/);
});
