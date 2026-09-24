import { test, expect } from "@playwright/test";

// Explore (/explore) — live voice companion. The Gemini Live round trip needs a
// real API key + microphone, so here we cover the auth guard, the setup UI for
// both modes, and the friendly "not configured" path (the emulator has no
// GEMINI_API_KEY, so startExploreSession reports configured:false).

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

// Explore lives behind the GAMES dropdown in the nav.
async function openExplore(page) {
  await page.locator("header.nav").getByRole("button", { name: "Games" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Explore" }).click();
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("explore"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Explore Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("explore route requires auth", async ({ page }) => {
  await page.goto("/explore");
  await expect(page).toHaveURL(/\/login/);
});

test("with no children, explore points parents to add one", async ({ page }) => {
  await registerAndOnboard(page);
  await openExplore(page);
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByText("Add a child on the")).toBeVisible();
});

test("pick a child and a mode; learning offers focuses; declining the microphone explains itself", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Hadi");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hadi")).toBeVisible();

  await openExplore(page);
  await expect(page.getByRole("radio", { name: "Hadi" })).toHaveAttribute("aria-checked", "true");

  // Exploration is the default; Learning reveals what-to-learn focuses.
  await expect(page.locator(".ex-mode.explore")).toHaveClass(/on/);
  await expect(page.getByText("What to learn?")).toHaveCount(0);
  await page.locator(".ex-mode.learn").click();
  await expect(page.getByRole("button", { name: "Speech & sounds", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Maths", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Something else" }).click();
  await expect(page.getByLabel("What to learn")).toBeVisible();

  // A child (or parent) who declines the microphone gets a plain-language
  // message — never a blank screen — and the setup stays usable.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  });
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("alert")).toContainText(/allow the microphone/i, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Start talking" })).toBeVisible();
});

test("parents can tune the buddy (voice, learning style, length, notes) and it persists", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Hadi");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hadi")).toBeVisible();

  await openExplore(page);
  await page.getByRole("button", { name: "Buddy settings" }).click();
  const panel = page.getByRole("region", { name: "Buddy settings" });
  await expect(panel).toBeVisible();

  // Defaults: Puck, "thinks harder" at Balanced, 20 minutes; 30 voices offered.
  const voice = panel.locator("select").first();
  await expect(voice.locator("option")).toHaveCount(30);
  await expect(voice).toHaveValue("Puck");
  await expect(panel.getByLabel(/Thinks harder/)).toBeChecked();
  await expect(panel.getByLabel(/How hard should it think/)).toHaveValue("medium");

  // Delivery instructions: how the buddy should actually speak to the child.
  await panel.getByLabel("Speaking speed").selectOption("slow");
  await panel.getByLabel("How much it says").selectOption("tiny");
  await panel.getByLabel("Language").selectOption("english");
  await panel.getByLabel(/Things to be careful about/).fill("Never mention his stammer.");

  await voice.selectOption("Leda");
  await panel.getByLabel(/Answers quickly/).check();
  await expect(panel.getByLabel(/How hard should it think/)).toHaveCount(0); // only for "thinks harder"
  await panel.getByLabel(/Conversation length/).fill("12");
  await panel.getByLabel(/Anything else for the buddy/).fill("Hadi is practising k and s sounds.");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

  // Leave and come back: the choices are remembered for the family.
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await openExplore(page);
  await page.getByRole("button", { name: "Buddy settings" }).click();
  const panel2 = page.getByRole("region", { name: "Buddy settings" });
  await expect(panel2.locator("select").first()).toHaveValue("Leda", { timeout: 30_000 });
  await expect(panel2.getByLabel(/Answers quickly/)).toBeChecked();
  await expect(panel2.getByLabel(/Conversation length/)).toHaveValue("12");
  await expect(panel2.getByLabel(/Anything else for the buddy/)).toHaveValue("Hadi is practising k and s sounds.");
  await expect(panel2.getByLabel("Speaking speed")).toHaveValue("slow");
  await expect(panel2.getByLabel("How much it says")).toHaveValue("tiny");
  await expect(panel2.getByLabel("Language")).toHaveValue("english");
  await expect(panel2.getByLabel(/Things to be careful about/)).toHaveValue("Never mention his stammer.");
});

test("parents choose each child's celebration sound; 'Try it' plays the saved file with confetti + balloons", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  for (const name of ["Hadi", "Ibrahim"]) {
    await page.getByRole("button", { name: "Add child" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(name)).toBeVisible();
  }

  await openExplore(page);
  await page.getByRole("button", { name: "Buddy settings" }).click();
  const panel = page.getByRole("region", { name: "Buddy settings" });
  const sound = panel.getByLabel(/When Hadi gets it right/);
  await expect(sound).toHaveValue("mashallah_clap"); // the default
  await expect(sound.locator("option")).toHaveCount(8);

  // Hadi gets clapping.
  await sound.selectOption("clapping");
  const clip = page.waitForResponse((r) => r.url().endsWith("/audio/celebrate/clapping.wav"));
  await panel.getByRole("button", { name: "Try it" }).click();
  const res = await clip;
  expect([200, 206]).toContain(res.status()); // audio is streamed with range requests (206)

  // The whole screen celebrates: balloons float up and the confetti canvas is painted.
  const overlay = page.getByTestId("celebration");
  await expect(overlay.locator(".cel-balloon")).toHaveCount(16);
  await page.waitForTimeout(700);
  const painted = await overlay.locator("canvas").evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 16) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(200);
  if (process.env.CELEBRATION_SHOT) {
    await page.screenshot({ path: process.env.CELEBRATION_SHOT });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: process.env.CELEBRATION_SHOT.replace(/\.png$/, "-later.png") });
  }
  await expect(overlay.locator(".cel-balloon")).toHaveCount(0, { timeout: 10_000 }); // cleans up after itself

  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

  // Ibrahim keeps his own choice (still the default), and Hadi's sticks.
  await page.getByRole("radio", { name: "Ibrahim" }).click();
  await expect(panel.getByLabel(/When Ibrahim gets it right/)).toHaveValue("mashallah_clap", { timeout: 20_000 });
  await page.getByRole("radio", { name: "Hadi" }).click();
  await expect(panel.getByLabel(/When Hadi gets it right/)).toHaveValue("clapping", { timeout: 20_000 });
});

test("buddy settings are isolated per child and per mode (a note for one never leaks to another)", async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("link", { name: "Children" }).click();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Hadi");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hadi")).toBeVisible();
  await page.getByRole("button", { name: "Add child" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ibrahim");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Ibrahim")).toBeVisible();

  await openExplore(page);
  await expect(page.getByRole("radio", { name: "Hadi" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Buddy settings" }).click();
  const panel = page.getByRole("region", { name: "Buddy settings" });
  const notes = panel.getByLabel(/Anything else for the buddy/);
  await expect(panel).toBeVisible();

  // Hadi, Exploration mode: a note just for this pairing.
  await notes.fill("Hadi explore note.");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

  // Same child, Learning mode: starts blank — the Exploration note must not follow.
  await page.locator(".ex-mode.learn").click();
  await expect(notes).toHaveValue("", { timeout: 20_000 });
  await notes.fill("Hadi learn note.");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 20_000 });

  // The other child sees neither of Hadi's notes.
  await page.getByRole("radio", { name: "Ibrahim" }).click();
  await expect(notes).toHaveValue("", { timeout: 20_000 });

  // Back to Hadi + Exploration: his Exploration note (not the Learning one) returns.
  await page.getByRole("radio", { name: "Hadi" }).click();
  await page.locator(".ex-mode.explore").click();
  await expect(notes).toHaveValue("Hadi explore note.", { timeout: 20_000 });
});
