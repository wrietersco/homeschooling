// Wikido Perspectives end to end: the child's lens switcher (URL, trail,
// spots of each lens) and the Studio's "Add a perspective" wizard. Paid AI is
// never called: the preview (dry run), artwork and voice callables are
// stubbed at the network layer; saving a previewed draft runs the real
// writeWikidoPerspective callable on the emulator (no model call needed).
import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
if (!getApps().length) initializeApp({ projectId: "homeschooling-b3e57" });

const SHOTS = process.env.WIKIDO_SHOTS_DIR || "test-results/wikido-perspectives";
const COLORS = { overview: "#2f6f8f", history: "#8a5a1f", food: "#a33a2a", fort: "#55606e", architecture: "#475569" };
const art = (name) => `https://example.com/persp-${name}.svg`;
const svg = (name) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS[name] || "#444"}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><text x="800" y="470" font-size="120" text-anchor="middle" fill="#fff" font-family="sans-serif">${name.toUpperCase()}</text></svg>`;
const spot = (id, label, x, y, extra = {}) => ({ id, label, blurb: `${label}!`, x, y, info: { title: label, body: [`All about ${label}.`], fact: `${label} fact.` }, ...extra });

function world(id) {
  return {
    id, title: `Lens world ${id}`, tagline: "Perspectives test", emoji: "🔭", status: "published", rootSceneId: "pakistan", discoveryCount: 7,
    scenes: {
      pakistan: {
        id: "pakistan", title: "Pakistan", narration: "A land of mountains, rivers and cities.", image: { src: art("overview"), alt: "Pakistan" },
        hotspots: [spot("k2", "K2 mountain", 30, 35), spot("indus", "Indus River", 62, 60)],
        perspectives: [{ id: "history", sceneId: "pakistan-history" }, { id: "food", sceneId: "pakistan-food" }],
      },
      "pakistan-history": {
        id: "pakistan-history", title: "Pakistan — History", narration: "Long ago, great cities grew by the Indus.", perspectiveOf: "pakistan", lens: "history",
        image: { src: art("history"), alt: "History" },
        hotspots: [spot("mohenjo-daro", "Mohenjo-daro", 25, 40), spot("mughals", "Mughal Empire", 55, 45, { childSceneId: "lahore-fort" }), spot("independence", "Independence 1947", 78, 62)],
      },
      "pakistan-food": {
        id: "pakistan-food", title: "Pakistan — Food", narration: "Spices, breads and sweet mangoes.", perspectiveOf: "pakistan", lens: "food",
        image: { src: art("food"), alt: "Food" },
        hotspots: [spot("biryani", "Biryani", 30, 50), spot("mango", "Mangoes", 60, 40), spot("chai", "Chai", 75, 65)],
      },
      "lahore-fort": {
        id: "lahore-fort", title: "Lahore Fort", narration: "A Mughal fort with a mirror palace.", image: { src: art("fort"), alt: "Fort" },
        hotspots: [spot("sheesh-mahal", "Sheesh Mahal", 50, 50)],
      },
    },
  };
}

async function routeArt(page) {
  await page.route(/https:\/\/example\.com\/persp-(\w+)\.svg/, (route) => {
    const name = /persp-(\w+)\.svg/.exec(route.request().url())[1];
    route.fulfill({ contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: svg(name) });
  });
}

async function signInSuperadmin(page, id) {
  const email = `${id}@example.com`;
  const user = await getAuth().createUser({ email, password: "test123456" });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test123456");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
  await page.getByLabel("Family name").fill("Lens family");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  return user;
}

test("child switches perspectives: lens buttons, turn animation, URL, lens spots, doorway trail", async ({ page }) => {
  test.setTimeout(120_000);
  const id = `lens-child-${Date.now()}`;
  const doc = getFirestore().collection("wikidoTopics").doc(id);
  await doc.set(world(id));
  await routeArt(page);
  const user = await signInSuperadmin(page, id);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/wikido/${id}`);
    const lenses = page.locator(".wd-lenses .wd-lens");
    await expect(lenses).toHaveCount(3);
    await expect(lenses.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan");
    await page.screenshot({ path: `${SHOTS}/child-overview.png` });

    await lenses.nth(1).click();
    await expect(page.locator(".wd-lens-turn")).toHaveCount(1); // the prism turn is playing
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/child-turning.png` });
    await expect(page).toHaveURL(new RegExp(`/wikido/${id}\\?lens=history$`));
    await expect(page.locator(".wd-lens-turn")).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan — History");
    await expect(lenses.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: /Mughal Empire/ }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/child-history.png` });

    // a deep link survives a reload
    await page.reload();
    await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan — History");

    // a doorway on the History picture opens its scene; the trail steps back onto History
    await page.goto(`/wikido/${id}/lahore-fort`);
    await expect(page.locator(".wd-crumb.current")).toHaveText("Lahore Fort");
    await expect(page.locator(".wd-crumb").first()).toHaveText("Pakistan — History");
    await expect(page.locator(".wd-lenses")).toHaveCount(0); // a scene without lenses shows no bar
    await page.locator(".wd-crumb").first().click();
    await expect(page).toHaveURL(new RegExp(`/wikido/${id}\\?lens=history$`));

    // reduced motion: a plain cross-fade, same result
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".wd-lens", { hasText: "Food" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?lens=food$`));
    await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan — Food");

    // phone: the lens row sits under the top bar
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator(".wd-lens-turn")).toHaveCount(0, { timeout: 5_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".wd-lenses .wd-lens")).toHaveCount(3);
    // the lens row never covers the top bar
    const bar = await page.locator(".wd-top").boundingBox();
    const row = await page.locator(".wd-lenses-row").boundingBox();
    expect(row.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    await expect.poll(() => page.locator(".wd-art img").evaluate((img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === "1"), { timeout: 5_000 }).toBe(true);
    await page.screenshot({ path: `${SHOTS}/child-phone.png` });
  } finally {
    await doc.delete();
    await getAuth().deleteUser(user.uid);
  }
});

test("superadmin adds a perspective with the wizard (preview → make → what's next)", async ({ page }) => {
  test.setTimeout(150_000);
  const id = `lens-studio-${Date.now()}`;
  const doc = getFirestore().collection("wikidoTopics").doc(id);
  const w = world(id);
  w.status = "draft";
  await doc.set(w);
  await routeArt(page);
  const calls = { preview: 0, paint: 0, voice: 0 };
  // preview = a dry run: stubbed (it would call the text model)
  await page.route("**/writeWikidoPerspective", async (route) => {
    const body = route.request().postDataJSON();
    if (!body?.data?.dryRun) return route.continue(); // saving a previewed draft: the real callable
    calls.preview += 1;
    await route.fulfill({
      json: { result: { saved: false, sceneId: "pakistan-architecture", baseId: "pakistan", scene: {
        id: "pakistan-architecture", title: "Pakistan — Architecture", narration: "Domes, minarets and mighty forts.",
        artPrompt: "A skyline of landmark buildings.", image: { src: "", alt: "Architecture" },
        hotspots: [spot("badshahi", "Badshahi Mosque", 20, 45), spot("minar", "Minar-e-Pakistan", 45, 40), spot("faisal", "Faisal Mosque", 70, 50), spot("haveli", "Old haveli", 85, 65)],
      } } },
    });
  });
  await page.route("**/generateWikidoSceneImage", async (route) => {
    calls.paint += 1;
    const { sceneId } = route.request().postDataJSON().data;
    await doc.update({ [`scenes.${sceneId}.image.src`]: art("architecture") });
    await route.fulfill({ json: { result: { url: art("architecture"), placements: [], visuals: {} } } });
  });
  await page.route("**/generateWikidoKokoroAudios", async (route) => {
    calls.voice += 1;
    const { clipIds } = route.request().postDataJSON().data;
    await route.fulfill({ json: { result: { results: clipIds.map((c) => ({ id: c, url: `https://example.com/${c}.mp3` })), recorded: clipIds.length, failed: 0 } } });
  });
  // the paid voice must never run in a test, whatever engine is picked
  await page.route("**/generateWikidoAudios", (route) => {
    calls.voice += 1;
    const { clipIds } = route.request().postDataJSON().data;
    return route.fulfill({ json: { result: { results: clipIds.map((c) => ({ id: c, url: `https://example.com/${c}.wav` })), recorded: clipIds.length, failed: 0, stoppedEarly: false } } });
  });
  const user = await signInSuperadmin(page, id);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/platform");
    await page.getByRole("button", { name: "Wikido Studio" }).click();
    await page.locator(".chip-main", { hasText: id }).click();
    const strip = page.locator(".lens-strip");
    await expect(strip).toBeVisible();
    await expect(strip.locator(".lens-chip .name")).toHaveText(["Overview", "History", "Food"]);
    await strip.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/studio-strip.png` });

    await strip.getByRole("button", { name: "＋ Add a perspective" }).click();
    const wz = page.getByRole("dialog");
    await expect(wz).toContainText("Pick a perspective");
    await expect(wz.locator(".lens-card", { hasText: "History" })).toContainText("Already added");
    await wz.locator(".lens-card", { hasText: "Architecture" }).click();
    await page.screenshot({ path: `${SHOTS}/wizard-1-pick.png` });
    await wz.getByRole("button", { name: "Next →" }).click();
    await expect(wz.locator(".lens-spots li")).toHaveCount(4);
    await page.screenshot({ path: `${SHOTS}/wizard-2-preview.png` });
    await wz.getByRole("button", { name: "Make it →" }).click();
    await expect(wz.locator(".wz-ok")).toContainText("Architecture perspective is ready", { timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/wizard-3-make.png` });
    await wz.getByRole("button", { name: "Next →" }).click();
    await expect(wz).toContainText("now has an Architecture perspective");
    await page.screenshot({ path: `${SHOTS}/wizard-4-next.png` });
    expect(calls).toMatchObject({ preview: 1, paint: 1 });
    expect(calls.voice).toBeGreaterThanOrEqual(1);

    // saved for real through the callable: back-link + lens list
    const saved = (await doc.get()).data();
    expect(saved.scenes.pakistan.perspectives.map((e) => e.id)).toEqual(["history", "food", "architecture"]);
    expect(saved.scenes["pakistan-architecture"]).toMatchObject({ perspectiveOf: "pakistan", lens: "architecture" });
    expect(saved.scenes["pakistan-architecture"].hotspots.map((h) => h.id)).toEqual(["badshahi", "minar", "faisal", "haveli"]);

    await wz.getByRole("button", { name: "Finish" }).click();
    await expect(strip.locator(".lens-chip .name")).toHaveText(["Overview", "History", "Food", "Architecture"]);
    await expect(page.locator(".ws-toolbar")).not.toContainText("unsaved edits");
  } finally {
    await doc.delete();
    await getAuth().deleteUser(user.uid);
  }
});
