import { test, expect } from "@playwright/test";

// Phase 2: family profile editing, guardian + child CRUD, and the skills module
// (create global skill → adopt → bind to a child). Runs against the emulator
// suite. Each test registers a fresh family so state is isolated.
test.describe.configure({ mode: "serial" });

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page, familyName) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(uniqueEmail("p2"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill(familyName);
  await page.getByLabel("Main guiding light").fill("Quran-centred upbringing.");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("edit family profile (guiding light + goal mode persists)", async ({ page }) => {
  await registerAndOnboard(page, "Profile Fam");
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel("Main guiding light").fill("The Quran and the Sunnah, above all.");
  // Goal mode is a pair of checkboxes (individual / combined).
  await page.getByLabel("Combined for all children").check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Reload → values persisted from Firestore.
  await page.reload();
  await expect(page.getByLabel("Main guiding light"))
    .toHaveValue("The Quran and the Sunnah, above all.", { timeout: 10_000 });
  await expect(page.getByLabel("Combined for all children")).toBeChecked({ timeout: 10_000 });
});

test("add a guardian and a child", async ({ page }) => {
  await registerAndOnboard(page, "CRUD Fam");

  await page.getByRole("link", { name: "Guardians" }).click();
  await page.getByRole("button", { name: "Add guardian" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Abu Hadi");
  await page.getByLabel("Occupation").fill("Engineer");
  await page.getByLabel("Goals for the children").fill("Strong character and Quran.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Abu Hadi")).toBeVisible();
  await expect(page.getByText("Engineer")).toBeVisible();

  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Hadi");
  await page.getByLabel("Strengths").fill("Curious, persistent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hadi")).toBeVisible();
  await expect(page.getByText("Strengths: Curious, persistent")).toBeVisible();
});

test("create a skill, then bind it to a child", async ({ page }) => {
  await registerAndOnboard(page, "Skills Fam");

  // Add a child first so the binding matrix has a column.
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ibrahim");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Ibrahim")).toBeVisible();

  // Create a new skill (goes through the callable → registry + family).
  await page.getByRole("link", { name: "Skills" }).click();
  const skillName = `Arabic Handwriting ${Date.now()}`;
  await page.getByLabel("Skill name").fill(skillName);
  await page.getByLabel("Skill category").fill("Language");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // It appears in the family's skills matrix (the name cell carries the
  // "· category" suffix, distinguishing it from the bind-checkbox cell).
  await expect(page.getByRole("cell", { name: `${skillName} · Language` })).toBeVisible({ timeout: 10_000 });

  // Bind to the child via the checkbox, then confirm it stays checked on reload.
  const checkbox = page.getByRole("checkbox", { name: `Bind ${skillName} to Ibrahim` });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Bind ${skillName} to Ibrahim` })).toBeChecked({ timeout: 10_000 });
});
