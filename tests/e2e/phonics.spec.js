import { test, expect, devices } from "@playwright/test";

// Phonics Playground (/phonics) — free-play sound building. Covers the auth
// guard, the full-screen game shell, cross-panel filtering, drag-to-canvas,
// snap-to-join with joined-sound playback, and word celebration.

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("phonics"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Phonics Test");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

// Drag a panel element to a canvas position with real pointer events (the
// playground uses Pointer Events, not HTML5 DnD).
async function dragTo(page, from, toX, toY) {
  await from.scrollIntoViewIfNeeded();
  const b = await from.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 10 });
  await page.mouse.up();
}

async function openPlayground(page) {
  await registerAndOnboard(page);
  await page.goto("/phonics");
  await expect(page.locator(".pp-title")).toHaveText(/Sound Splash/);
  // The canvas is a full-height endless plane now (no bottom drawer) — wait a
  // beat so layout settles before measuring geometry.
  await page.waitForTimeout(400);
  return page.locator(".pp-canvas");
}

// Locate a block/row by its display letters, ignoring Material icon
// ligature text (e.g. "volume_up") that also lives inside these elements.
const blockByLetter = (page, letter) =>
  page.locator(".pp-block").filter({ has: page.locator(".pp-block-letter", { hasText: new RegExp(`^${letter}$`) }) });
const rowByLetters = (page, letters) =>
  page.locator(".pp-row").filter({ has: page.locator(".pp-tile-text", { hasText: new RegExp(`^${letters}$`) }) });

test("phonics route requires auth — redirects to login when signed out", async ({ page }) => {
  await page.goto("/phonics");
  await expect(page).toHaveURL(/\/login/);
});

test("playground opens full-screen from the nav with the A–Z panel", async ({ page }) => {
  await registerAndOnboard(page);
  // Phonics lives behind the GAMES dropdown in the nav.
  await page.locator("header.nav").getByRole("button", { name: "Games" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Phonics" }).click();
  await expect(page).toHaveURL(/\/phonics$/);
  await expect(page.locator(".pp-title")).toContainText("Sound Splash");
  await expect(page.locator(".pp-panel-right")).toBeVisible();
  // Two-column A–Z grid
  await expect(page.locator(".pp-blocks")).toHaveCSS("grid-template-columns", /.+ .+/);
  await expect(page.locator(".pp-block")).toHaveCount(26);
  // The sounds drawer is gone for good — a spacebar key sits at the bottom.
  await expect(page.locator(".pp-panel-bottom")).toHaveCount(0);
  await expect(page.locator(".pp-spacebar")).toBeVisible();
  // Empty canvas invites the child in
  await expect(page.locator(".pp-hint-bubble")).toContainText("Drag");
});

test("dragging blocks onto the canvas snaps them into a word", async ({ page }) => {
  const canvas = await openPlayground(page);
  const box = await canvas.boundingBox();
  const tile = 65; // ~clamp(54, 9vmin of 720, 84)
  const cy = box.y + box.height * 0.45;

  await dragTo(page, page.locator(".pp-block", { hasText: /^c$/ }), box.x + 220, cy);
  await expect(page.locator(".pp-row")).toHaveCount(1);
  await expect(page.locator(".pp-tile")).toHaveCount(1);
  // The first letter anchors the word: its position must never move as the
  // word grows.
  const originX = (await page.locator(".pp-row").boundingBox()).x;

  // Drop "a" beside "c" — the two rows snap into one joined row.
  await dragTo(page, page.locator(".pp-block", { hasText: /^a$/ }), box.x + 220 + tile * 0.9, cy);
  await expect(page.locator(".pp-row")).toHaveCount(1);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(2);
  await expect(page.locator(".pp-blend")).toBeVisible(); // blend bubble appears on joined rows
  expect((await page.locator(".pp-row").boundingBox()).x).toBeCloseTo(originX, 0);

  // "t" completes cat → dictionary word celebration banner.
  await dragTo(page, page.locator(".pp-block", { hasText: /^t$/ }), box.x + 220 + tile * 1.8, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(3);
  expect((await page.locator(".pp-row").boundingBox()).x).toBeCloseTo(originX, 0);
  await expect(page.locator(".pp-banner")).toContainText("cat", { timeout: 15_000 });
  await expect(page.locator(".pp-score")).toContainText("1");

  // Dropping on the LEFT of the row prepends: existing letters stay put and
  // the origin grows leftward.
  await dragTo(page, page.locator(".pp-block", { hasText: /^m$/ }), box.x + 150, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(4);
  expect((await page.locator(".pp-row").boundingBox()).x).toBeLessThan(originX);
  const rowLetters = await page.locator(".pp-row .pp-tile-text").allTextContents();
  expect(rowLetters.join("")).toBe("mcat");
});

test("tiles can be extracted from a joined row and trashed", async ({ page }) => {
  const canvas = await openPlayground(page);
  const box = await canvas.boundingBox();
  const cy = box.y + box.height * 0.5;

  await dragTo(page, blockByLetter(page, "m"), box.x + 220, cy);
  await dragTo(page, blockByLetter(page, "a"), box.x + 220 + 58, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(2);

  // Drag the "a" tile (second in the row) far away — it is lifted out into
  // its own row while the origin row keeps "m".
  const aTile = page.locator(".pp-row .pp-tile").nth(1);
  const tb = await aTile.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + box.height - 60, { steps: 8 });
  await page.mouse.up();
  await expect(rowByLetters(page, "m").locator(".pp-tile")).toHaveCount(1);
  await expect(page.locator(".pp-row")).toHaveCount(2); // "m" row + lone "a" row

  // Feed the "a" to the trash monster.
  await dragTo(page, rowByLetters(page, "a"), box.x + box.width - 40, box.y + 90);
  await expect(page.locator(".pp-row")).toHaveCount(1);
});

test("clear button empties the canvas", async ({ page }) => {
  const canvas = await openPlayground(page);
  const box = await canvas.boundingBox();
  await dragTo(page, page.locator(".pp-block", { hasText: /^d$/ }), box.x + 200, box.y + 200);
  await expect(page.locator(".pp-row")).toHaveCount(1);
  await page.locator(".pp-clear").click();
  await expect(page.locator(".pp-row")).toHaveCount(0);
  await expect(page.locator(".pp-hint-bubble")).toBeVisible();
});

test("spacebar inserts one space block; blocks attach to it; the big speaker reads the phrase", async ({ page }) => {
  const canvas = await openPlayground(page);
  const synthRequests = [];
  await page.route("**/us-central1/synthesizeSpeech", (route) => {
    try { synthRequests.push(JSON.parse(route.request().postData()).data); } catch { /* not JSON */ }
    route.continue();
  });

  // Build "cat" (the last touched row becomes the spacebar's target).
  const box = await canvas.boundingBox();
  const cy = box.y + box.height * 0.4;
  await dragTo(page, blockByLetter(page, "c"), box.x + 220, cy);
  await dragTo(page, blockByLetter(page, "a"), box.x + 220 + 58, cy);
  await dragTo(page, blockByLetter(page, "t"), box.x + 220 + 116, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(3);

  // Pressing Space (physical key or the on-screen key) appends exactly ONE
  // empty space block — it never stacks.
  await page.keyboard.press("Space");
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(4);
  await expect(page.locator(".pp-row .pp-tile").nth(3)).toHaveClass(/is-space/);
  await page.locator(".pp-spacebar").click({ force: true });
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(4);

  // A block dropped at the row's end attaches AFTER the space → a phrase.
  const row = page.locator(".pp-row");
  for (const letter of ["s", "a", "t"]) {
    const rb = await row.boundingBox();
    await dragTo(page, blockByLetter(page, letter), rb.x + rb.width - 8, rb.y + rb.height / 2);
    await expect(page.locator(".pp-row .pp-tile")).toHaveCount(4 + ["s", "a", "t"].indexOf(letter) + 1);
  }
  await expect(page.locator(".pp-row .pp-tile.is-space")).toHaveCount(1);

  // The big golden speaker reads the whole canvas — phrase included.
  await page.locator(".pp-speak-all").click({ force: true });
  await expect
    .poll(() => synthRequests.filter((d) => d?.text === "cat sat").length, { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test("row speaker is on every row and speaks the formed sound even for non-words", async ({ page }) => {
  const canvas = await openPlayground(page);
  const synthRequests = [];
  await page.route("**/us-central1/synthesizeSpeech", (route) => {
    try { synthRequests.push(JSON.parse(route.request().postData()).data); } catch { /* not JSON */ }
    route.continue();
  });

  const box = await canvas.boundingBox();
  const cy = box.y + box.height * 0.4;
  await dragTo(page, blockByLetter(page, "x"), box.x + 220, cy);
  // Even a lone block has its golden phrase speaker.
  await expect(page.locator(".pp-blend")).toHaveCount(1);

  await dragTo(page, blockByLetter(page, "q"), box.x + 220 + 58, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(2);
  await page.locator(".pp-blend").click({ force: true });
  // x + qu is no dictionary word — it is spoken as the sound it forms.
  await expect
    .poll(() => synthRequests.filter((d) => d?.text === "kskw").length, { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test("Space inside the voice settings panel does not add a space block", async ({ page }) => {
  const canvas = await openPlayground(page);
  const box = await canvas.boundingBox();
  await dragTo(page, blockByLetter(page, "c"), box.x + 220, box.y + box.height * 0.4);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(1);
  await page.getByLabel("Word voice settings").click({ force: true });
  await expect(page.locator(".pp-settings")).toBeVisible();
  await page.locator(".pp-settings button").first().focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".pp-row .pp-tile.is-space")).toHaveCount(0);
});

test("the canvas is an endless plane — drag empty sky to pan, recenter returns", async ({ page }) => {
  const canvas = await openPlayground(page);
  const box = await canvas.boundingBox();
  await dragTo(page, blockByLetter(page, "d"), box.x + 200, box.y + 200);
  const row = page.locator(".pp-row");
  await expect(row).toHaveCount(1);

  // Pan by dragging a stretch of empty sky (start well clear of the block).
  await page.mouse.move(box.x + box.width - 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 270, box.y - 110, { steps: 8 });
  await page.mouse.up();
  const panned = await row.boundingBox();
  expect(panned.x).toBeLessThan(box.x + 200 - 30); // the block rode along, left + up
  expect(panned.y).toBeLessThan(box.y + 200 - 30);

  // The compass button re-centres the viewport on the blocks.
  await page.locator(".pp-recenter").click();
  // Measure the tiles (the row's box also spans its floating speaker button).
  const home = await row.locator(".pp-tile").first().boundingBox();
  expect(home.x).toBeCloseTo(box.x + (box.width - home.width) / 2, 0);
  expect(home.y).toBeCloseTo(box.y + (box.height - home.height) / 2, 0);

  // Blocks dropped after panning land in the new viewport (world coords follow
  // the pan), so building far from the origin keeps working.
  await dragTo(page, blockByLetter(page, "o"), box.x + 120, box.y + box.height - 90);
  await expect(page.locator(".pp-row")).toHaveCount(2);
});

test("word voice modal offers and marks Gemini voices", async ({ page }) => {
  await openPlayground(page);
  const openSettings = async () => {
    await page.locator("header.pp-topbar").getByRole("button", { name: "Word voice settings" }).click();
    await expect(page.locator(".pp-settings")).toBeVisible();
  };
  await openSettings();
  const settings = page.locator(".pp-settings");
  // The auto teacher voice goes through the Gemini TTS pipeline — badged as such.
  await expect(settings.locator(".pp-voice-option").first()).toContainText("teacher voice");
  await expect(settings.locator(".pp-badge.gemini").first()).toContainText("Gemini");
  // Let the shared voice catalog settle before judging the lists. A slow or
  // hung emulator call is tolerated — every assertion below handles both the
  // loaded and the still-loading states.
  await expect(settings.locator(".pp-voices-loading")).toHaveCount(0, { timeout: 8000 }).catch(() => {});
  // Installed speechSynthesis voices are labelled as device voices (headless
  // Chromium may expose none, in which case the empty notice shows instead).
  if ((await settings.locator(".pp-voices-empty:not(.pp-voices-loading)").count()) === 0) {
    expect(await settings.locator(".pp-badge.device").count()).toBeGreaterThan(0);
  }
  // When the shared TTS catalog is configured, its Gemini voices are offered
  // and a pick sticks across a reload (persisted like any other choice).
  const geminiPicks = settings.locator(".pp-voice-option.gemini-voice");
  if ((await geminiPicks.count()) > 0) {
    await geminiPicks.first().click();
    await expect(geminiPicks.first()).toHaveClass(/active/);
    await page.reload();
    await openSettings();
    const reloaded = page.locator(".pp-settings");
    await expect(reloaded.locator(".pp-voices-loading")).toHaveCount(0);
    await expect(reloaded.locator(".pp-voice-option.gemini-voice").first()).toHaveClass(/active/);
  }
});

test("the golden speaker speaks the word in the selected Gemini voice", async ({ page }) => {
  const canvas = await openPlayground(page);

  // Capture every synthesizeSpeech request the page sends.
  const synthRequests = [];
  await page.route("**/us-central1/synthesizeSpeech", (route) => {
    try { synthRequests.push(JSON.parse(route.request().postData()).data); } catch { /* not JSON */ }
    route.continue();
  });

  // Pick a specific Gemini voice (skip when the catalog isn't configured here).
  await page.locator("header.pp-topbar").getByRole("button", { name: "Word voice settings" }).click();
  await expect(page.locator(".pp-settings")).toBeVisible();
  await expect(page.locator(".pp-voices-loading")).toHaveCount(0, { timeout: 8000 }).catch(() => {});
  const geminiPicks = page.locator(".pp-voice-option.gemini-voice");
  test.skip((await geminiPicks.count()) === 0, "TTS voice catalog not configured in this environment");
  const picked = (await geminiPicks.first().locator(".pp-voice-name").innerText()).trim();
  await geminiPicks.first().click({ force: true }); // options sit in the scrollable list
  await expect(geminiPicks.first()).toHaveClass(/active/);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".pp-settings")).toBeHidden();

  // Build "dog" (≠ the settings sample "cat") and press the golden speaker.
  const box = await canvas.boundingBox();
  const cy = box.y + box.height * 0.45;
  await dragTo(page, blockByLetter(page, "d"), box.x + 220, cy);
  await dragTo(page, blockByLetter(page, "o"), box.x + 220 + 58, cy);
  await dragTo(page, blockByLetter(page, "g"), box.x + 220 + 116, cy);
  await expect(page.locator(".pp-row .pp-tile")).toHaveCount(3);
  await page.locator(".pp-blend").click({ force: true }); // the bubble wobbles — never "stable"

  // The word synthesis request must carry the picked Gemini voice. This is
  // exactly the regression the bug report was about: the blend path silently
  // using the default voice instead of the user's choice.
  await expect
    .poll(
      () => synthRequests.filter((d) => d?.text === "dog" && d?.voiceName === picked && d?.provider === "gemini").length,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});

test.describe("mobile landscape gate", () => {
  // Emulate a touch phone held upright (Pixel 7). The browser-type property is
  // dropped — inside a describe group it would force a new worker.
  const phone = { ...devices["Pixel 7"] };
  delete phone.defaultBrowserType;
  test.use(phone);

  test("portrait phones see the rotate prompt; landscape unlocks the game", async ({ page }) => {
    await registerAndOnboard(page);
    await page.goto("/phonics");
    await expect(page.locator(".pp-rotate-card")).toContainText("sideways");
    // Rotating to landscape dismisses the gate and reveals the game.
    await page.setViewportSize({ width: 900, height: 400 });
    await expect(page.locator(".pp-rotate")).toBeHidden();
    await expect(page.locator(".pp-title")).toContainText("Sound Splash");
  });
});
