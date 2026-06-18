import { test, expect } from "@playwright/test";

// End-to-end auth + onboarding against the Firebase emulator suite. Uses a
// unique email per run so repeated local runs don't collide in the Auth
// emulator. Serial so the shared dev server / emulator state stays predictable.
test.describe.configure({ mode: "serial" });

function uniqueEmail(tag) {
  // Avoid Date.now in app code, but in tests a timestamp keeps emails unique.
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

test("register → onboarding → dashboard, then sign out", async ({ page }) => {
  const email = uniqueEmail("owner");
  const password = "test123456";

  await page.goto("/login");

  // Switch to register mode and create the account.
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Abu Hadi");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // No family yet → routed to onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your family" })).toBeVisible();

  // Complete onboarding.
  await page.getByLabel("Family name").fill("Dar-al-Hikmah");
  await page.getByLabel("Main guiding light").fill("The Quran and prophetic example.");
  await page.getByRole("button", { name: "Create family" }).click();

  // Lands on the dashboard showing the family + guiding light + owner member.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dar-al-Hikmah" })).toBeVisible();
  await expect(page.getByText("The Quran and prophetic example.")).toBeVisible();
  await expect(page.getByText(/Members \(1\)/)).toBeVisible();
  // The single member is the owner, shown with name + role in the list.
  await expect(page.getByRole("listitem").filter({ hasText: "owner" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Abu Hadi" })).toBeVisible();

  // Sign out returns to a signed-out shell.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("onboarded user signing in again goes straight to dashboard", async ({ page }) => {
  const email = uniqueEmail("returning");
  const password = "test123456";

  // First session: register + onboard.
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Returning Fam");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  // Second session: sign in → should skip onboarding.
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Returning Fam" })).toBeVisible();
});

test("a signed-out user is bounced from a protected route to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)dashboard$/);
});
