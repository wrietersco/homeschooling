import { test, expect } from "@playwright/test";

// Division Playland deep links: every screen / board state has its own URL
// (play param, ruler tree, view, #size/#cut/#book entries), and `from` survives.

const BASE = "/games/math/division.html";
const FROM = "?from=/games";
const sleep = (page, ms) => page.waitForTimeout(ms);

async function typeOnPad(page, keys) {
  for (const k of keys) await page.locator("#pad .key", { hasText: k }).click();
  await page.locator("#pad .key.ok").click();
}
async function cutInto(page, digit) {
  await page.locator(".scale").first().click();
  await sleep(page, 350);
  await page.click("#tCut");
  await typeOnPad(page, [digit]);
  await page.click("#btnYes");
  await sleep(page, 1800);
}
const search = page => page.evaluate(() => location.search);
const hash = page => page.evaluate(() => location.hash);
const labels = page => page.locator("#overlay .lenlabel").allTextContents();
const introVisible = page => page.evaluate(() => !document.querySelector("#intro").classList.contains("hide"));

function collectErrors(page) {
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  return errs;
}

test("intro and play have different URLs; Back from play returns to the intro", async ({ page }) => {
  await page.goto(BASE + FROM);
  expect(await search(page)).toBe(FROM);
  expect(await introVisible(page)).toBe(true);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await expect.poll(() => search(page)).toBe(FROM + "&play=1");
  await page.goBack();
  await expect.poll(() => introVisible(page)).toBe(true);
  expect(await search(page)).toBe(FROM);
  await page.goForward();
  await expect.poll(() => introVisible(page)).toBe(false);
  expect(await page.locator(".scale").count()).toBe(1); // no second ruler
});

test("cold open of the play URL skips the intro and starts silently", async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto(BASE + FROM + "&play=1");
  await expect(page.locator(".scale")).toHaveCount(1);
  expect(await introVisible(page)).toBe(false);
  await expect(page.locator("#overlay .lenlabel").first()).toHaveText("100 cm");
  expect(errs.filter(e => !/favicon|fonts\.g/i.test(e))).toEqual([]);
});

test("cut → reload restores the exact board, math book and view", async ({ page }) => {
  await page.goto(BASE + FROM);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await sleep(page, 1000);
  await cutInto(page, "3");
  // cut one 33.33 piece in half too (nested)
  await page.locator(".scale").nth(1).click();
  await sleep(page, 350);
  await page.click("#tCut");
  await typeOnPad(page, ["2"]);
  await page.click("#btnYes");
  await sleep(page, 1800);
  await page.click("#zIn"); await sleep(page, 700);
  const before = await labels(page);
  await expect.poll(() => search(page), { timeout: 3000 }).toContain("t=100{");
  const url = page.url();
  expect(url).toContain("from=/games");
  expect(url).toContain("&v=");
  await page.reload();
  await expect(page.locator(".scale").nth(5)).toBeAttached();
  expect(await introVisible(page)).toBe(false);
  expect(await labels(page)).toEqual(before);
  await expect(page.locator("#cards .card")).toHaveCount(2);
  await sleep(page, 800);
  expect(page.url()).toBe(url); // the restored board writes back the same link
});

test("piece offsets, long-press splits and decimal parts survive a reload", async ({ page }) => {
  await page.goto(BASE + FROM);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await sleep(page, 1000);
  const box = await page.locator(".scale .body").first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down(); await sleep(page, 800); await page.mouse.up();
  await page.click("#btnYes"); await sleep(page, 1800);
  // drag the second piece somewhere else
  const b2 = await page.locator(".scale .body").nth(2).boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2 + 60, b2.y + b2.height / 2 + 140, { steps: 8 });
  await page.mouse.up();
  await sleep(page, 900);
  await expect.poll(() => search(page)).toContain("@");
  const before = await labels(page);
  await page.reload();
  await expect(page.locator(".scale")).toHaveCount(3);
  await sleep(page, 600);
  expect(await labels(page)).toEqual(before);
});

test("reset returns to a fresh board URL", async ({ page }) => {
  await page.goto(BASE + FROM + "&play=1");
  await page.locator(".scale").first().waitFor();
  await sleep(page, 600);
  await cutInto(page, "4");
  await expect.poll(() => search(page)).toContain("t=");
  await page.click("#tReset"); await page.click("#tReset");
  await sleep(page, 2500);
  await expect.poll(() => search(page), { timeout: 3000 }).toBe(FROM + "&play=1");
});

test("Math Book (phone): open pushes #book, Back closes it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto(BASE + FROM);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await sleep(page, 500);
  await page.click("#bookBtn");
  await expect(page.locator("#book")).toHaveClass(/open/);
  expect(await hash(page)).toBe("#book");
  await page.goBack();
  await expect(page.locator("#book")).not.toHaveClass(/open/);
  expect(await search(page)).toContain("play=1"); // still in the game
  // the close button leaves no extra entry behind
  await page.click("#bookBtn");
  await page.click("#bookClose");
  await expect(page.locator("#book")).not.toHaveClass(/open/);
  await expect.poll(() => hash(page)).toBe("");
  await page.goBack();                       // straight to the intro: no leftover book entry
  await expect.poll(() => introVisible(page)).toBe(true);
});

test("Math Book (desktop): hide pushes #book-off, Back shows it again", async ({ page }) => {
  await page.goto(BASE + FROM + "&play=1");
  await page.locator(".scale").first().waitFor();
  await page.evaluate(() => localStorage.removeItem("mathBookOff"));
  await page.click("#bookClose");
  await expect(page.locator("body")).toHaveClass(/bookOff/);
  expect(await hash(page)).toBe("#book-off");
  await page.goBack();
  await expect(page.locator("body")).not.toHaveClass(/bookOff/);
});

test("number pad: opening pushes #size / #cut, Back and Escape close it", async ({ page }) => {
  await page.goto(BASE + FROM);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await sleep(page, 600);
  await page.click("#tRuler");
  await expect(page.locator("#modal")).toBeVisible();
  expect(await hash(page)).toBe("#size");
  await page.goBack();
  await expect(page.locator("#modal")).toBeHidden();
  expect(await hash(page)).toBe("");
  expect(await search(page)).toContain("play=1");

  await page.click("#tCut");
  expect(await hash(page)).toBe("#cut");
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
  await expect.poll(() => hash(page)).toBe("");
  // Escape used history.back(), so one more Back goes to the intro — not a trapped duplicate
  await page.goBack();
  await expect.poll(() => introVisible(page)).toBe(true);
});

test("a submitted pad leaves no history trap", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#btnStart", { force: true });
  await page.locator(".scale").first().waitFor();
  await sleep(page, 1000);
  await page.locator(".scale").first().click();
  await sleep(page, 350);
  await page.click("#tRuler");
  await typeOnPad(page, ["5", "0"]);
  await sleep(page, 2200);
  await expect.poll(() => hash(page)).toBe("");
  await page.goBack();
  await expect.poll(() => introVisible(page)).toBe(true);
});

test("#cut opens the pad on a cold load", async ({ page }) => {
  await page.goto(BASE + FROM + "&play=1#cut");
  await expect(page.locator("#modal")).toBeVisible();
  await expect(page.locator("#mTitle")).toHaveText(/Cut into how many/);
});

test("?from= is kept on every link and in the URL", async ({ page }) => {
  await page.goto(BASE + "?from=/games/x&play=1&t=100{c4:25,25,25,25}");
  await expect(page.locator(".scale")).toHaveCount(5);
  expect(await page.getAttribute("#backBtn", "href")).toMatch(/index\.html\?from=\/games\/x$/);
  expect(await page.getAttribute(".introBack", "href")).toMatch(/index\.html\?from=\/games\/x$/);
  await sleep(page, 800);
  expect(page.url()).toContain("from=/games/x");
  // the hub still works and carries it into the game card
  await page.goto("/games/math/index.html?from=/games/x");
  await expect(page.locator("#returnPill")).toBeVisible();
  expect(await page.getAttribute("a.gameCard.division", "href")).toMatch(/division\.html\?from=\/games\/x$/);
  expect(page.url()).toContain("from=/games/x");
});

test("garbage params fall back to the intro without errors", async ({ page }) => {
  const errs = collectErrors(page);
  for (const q of [
    "?from=/games&play=1&t=lol",
    "?from=/games&play=1&t=100{c3:1,2",
    "?from=/games&play=1&t=9999",
    "?from=/games&play=1&v=a,b,c",
    "?from=/games&play=banana&t=100&v=1",
    "?from=/games&play=1&t=100{c99:1,1}",
    "?from=/games&t=%E0%A4%A&v=%",
  ]) {
    await page.goto(BASE + q);
    expect(await introVisible(page), q).toBe(true);
    await expect(page.locator(".scale")).toHaveCount(0);
    expect(await search(page), q).toBe("?from=/games");
  }
  await page.goto(BASE + "?play=1#nonsense");
  await expect(page.locator(".scale")).toHaveCount(1); // valid play, junk hash ignored
  expect(await hash(page)).toBe("");
  expect(errs.filter(e => !/favicon|fonts\.g/i.test(e))).toEqual([]);
  // and then Let's Play still works
  await page.goto(BASE + "?from=/games&play=1&t=lol");
  await page.click("#btnStart", { force: true });
  await expect(page.locator(".scale")).toHaveCount(1);
});

test("Copy link copies the current board and toasts (phone width)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto(BASE + FROM + "&play=1");
  await page.locator(".scale").first().waitFor();
  await sleep(page, 600);
  await cutInto(page, "3");
  const box = await page.locator("#toolbar").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.click("#tLink");
  await expect(page.locator("#toast")).toContainText("Link copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("/games/math/division.html?from=/games&play=1&t=100{c3:");
  expect(copied).not.toContain("#");
  // open the copied link in a fresh page
  const p2 = await context.newPage();
  await p2.goto(copied);
  await expect(p2.locator(".scale")).toHaveCount(4);
});
