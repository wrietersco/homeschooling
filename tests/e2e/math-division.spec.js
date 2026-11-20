import { test, expect } from "@playwright/test";

// Division Playland (static vanilla-JS game under /games/math/).
// Covers the three ruler promises: any size fits the canvas, millimetres
// always exist and reveal with zoom, and division works with decimals.

const PAGE = "/games/math/division.html?from=/games";

async function startGame(page) {
  await page.goto(PAGE);
  // the Start button pulses forever, which reads as "unstable" to Playwright
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await page.waitForTimeout(1000); // drop-in + fit animation
}

async function typeOnPad(page, keys) {
  for (const k of keys) {
    await page.locator("#pad .key", { hasText: k }).click();
  }
  await page.locator("#pad .key.ok").click();
}

async function setSize(page, digits) {
  await page.locator(".scale").first().click();
  await page.waitForTimeout(350); // jiggle
  await page.click("#tRuler");
  await expect(page.locator("#modal")).toBeVisible();
  await typeOnPad(page, digits);
  await page.waitForTimeout(1700); // resize tween + refit
}

const mmOpacity = page =>
  page.evaluate(() => {
    const p = document.querySelector(".scale .tick.mm");
    return p ? parseFloat(p.style.opacity || "0") : -1;
  });

test("any ruler size fits the canvas like the 100 cm one", async ({ page }) => {
  await startGame(page);
  const vp = page.viewportSize();

  for (const size of ["1", "500", "2.5"]) {
    await setSize(page, [...size]);
    await expect(page.locator("#overlay .lenlabel").first()).toHaveText(
      new RegExp(`^${size.replace(".", "\\.")} cm$`)
    );
    const box = await page.locator(".scale .body").first().boundingBox();
    expect(box.width, `${size} cm ruler should fill a good part of the width`)
      .toBeGreaterThan(vp.width * 0.3);
    expect(box.x).toBeGreaterThanOrEqual(-2);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 2);
  }
});

test("a 1 cm scale clearly shows its millimetres", async ({ page }) => {
  await startGame(page);
  await setSize(page, ["1"]);

  // mm tick path exists and is fully in focus at fit zoom
  expect(await mmOpacity(page)).toBeGreaterThanOrEqual(0.6);
  // the ten millimetre positions carry numbers 1..9 (whole cm stays 0/1)
  const mmNums = await page.locator("#overlay .mmnum").allTextContents();
  expect(mmNums.length).toBeGreaterThanOrEqual(8);
  expect(mmNums.join(",")).toContain("5");
});

test("millimetres are always there and reveal as the kid zooms", async ({ page }) => {
  await startGame(page);
  await setSize(page, ["5", "0", "0"]);

  // from a distance the mm lines are (almost) invisible
  const before = await mmOpacity(page);
  expect(before).toBeLessThanOrEqual(0.05);

  // zoom into the middle of the ruler with the wheel
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(500);
  const mid = await mmOpacity(page);
  expect(mid).toBeGreaterThan(before + 0.1); // smoothly coming into focus

  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(500);
  expect(await mmOpacity(page)).toBeGreaterThanOrEqual(0.75); // crisp
  // numbers never flood the screen: the overlay is culled to the viewport
  const nums = await page.locator("#overlay .ticknum").count();
  expect(nums).toBeGreaterThan(0);
  expect(nums).toBeLessThanOrEqual(90);
});

test("decimal division: 100 ÷ 3 gives 33.33 cm pieces", async ({ page }) => {
  await startGame(page);

  await page.locator(".scale").first().click();
  await page.waitForTimeout(350);
  await page.click("#tCut");
  await typeOnPad(page, ["3"]);
  await page.click("#btnYes");
  await page.waitForTimeout(1800); // spawn + refit

  // three equal decimal pieces (no leftover piece: 0.01 cm is under 1 mm)
  const labels = await page.locator("#overlay .lenlabel").allTextContents();
  expect(labels.filter(t => t === "33.33 cm").length).toBe(3);
  expect(labels.some(t => t.includes("left over"))).toBe(false);

  // the math book tells the honest decimal story
  const card = page.locator("#cards .card").first();
  await expect(card).toContainText("33.33");
  await expect(card).toContainText("0.01");
});

test("decimal pieces keep dividing: 33.33 ÷ 2", async ({ page }) => {
  await startGame(page);
  await page.locator(".scale").first().click();
  await page.waitForTimeout(350);
  await page.click("#tCut");
  await typeOnPad(page, ["3"]);
  await page.click("#btnYes");
  await page.waitForTimeout(1800);

  // cut one 33.33 cm piece in half
  await page.locator(".scale").nth(1).click();
  await page.waitForTimeout(350);
  await page.click("#tCut");
  await typeOnPad(page, ["2"]);
  await page.click("#btnYes");
  await page.waitForTimeout(1800);

  const labels = await page.locator("#overlay .lenlabel").allTextContents();
  expect(labels.filter(t => t === "16.66 cm").length).toBe(2);
  // 33.33 − 2 × 16.66 = 0.01 → too tiny to see, so no leftover piece spawns
  expect(labels.some(t => t.includes("left over"))).toBe(false);
});

test("long-press split snaps to a visible mark and reports decimals", async ({ page }) => {
  await startGame(page);
  await setSize(page, ["1", "0"]); // 10 cm ruler

  const box = await page.locator(".scale .body").first().boundingBox();
  const x = box.x + box.width * 0.4, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(800); // long press fires at 650 ms
  await page.mouse.up();

  await expect(page.locator("#confirmBar")).toBeVisible();
  await expect(page.locator("#confirmText")).toHaveText(/Cut at \d+(\.\d+)? cm\?/);

  await page.click("#btnYes");
  await page.waitForTimeout(1600);
  // overlay labels follow creation order: root first, then the two new pieces
  const labels = await page.locator("#overlay .lenlabel").allTextContents();
  expect(labels[0]).toBe("10 cm"); // the root keeps its label
  const pieces = labels.slice(1).map(t => parseFloat(t)).filter(n => !isNaN(n));
  expect(pieces.length).toBe(2);
  expect(pieces.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 1);
});

test("decimal size entry via the point key", async ({ page }) => {
  await startGame(page);
  await page.locator(".scale").first().click();
  await page.waitForTimeout(350);
  await page.click("#tRuler");
  await typeOnPad(page, ["7", ".", "5"]);
  await page.waitForTimeout(1700);
  await expect(page.locator("#overlay .lenlabel").first()).toHaveText("7.5 cm");
});
