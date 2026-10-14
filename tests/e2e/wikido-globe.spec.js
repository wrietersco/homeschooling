import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
if (!getApps().length) initializeApp({ projectId: "homeschooling-b3e57" });

// The 3D GLOBE view — a second form of immersive Wikido world. Globe worlds
// carry NO bundled content: the superadmin grows them by pinning places, and
// every scene is a generated image scene just like in picture worlds. Both
// specs here seed a globe topic into the emulator, then exercise the read path
// (child) and the studio curation path. The pinning generation itself needs
// the live model, so its guards are covered by unit tests.

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

const svg = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${fill}"/></svg>`;

const ART = "https://example.com/globe-e2e";
const spot = (id, label, blurb, lat, lng, level, sceneId) => ({
  id,
  label,
  blurb,
  lat,
  lng,
  level,
  countryId: "pk",
  childSceneId: sceneId,
  info: { title: label, body: [`About ${label}.`], fact: `A ${label} fact!` },
});

// A stand-in for a Studio-grown globe world: hub + three image scenes in
// Pakistan, one per zoom layer.
function globeTopic(id, title) {
  return {
    id,
    title,
    tagline: "Pinned places",
    emoji: "🌍",
    view: "globe",
    status: "published",
    origin: "studio",
    rootSceneId: "globe",
    discoveryCount: 3,
    scenes: {
      globe: {
        id: "globe",
        title,
        narration: "Spin me.",
        image: { src: "", alt: "globe" },
        hotspots: [
          spot("pakistan", "Pakistan", "Mountains and the Indus", 30.4, 69.3, "country", "pakistan"),
          spot("lahore", "Lahore", "City of gardens", 31.55, 74.34, "city", "lahore"),
          spot("badshahi", "Badshahi Mosque", "A red-sandstone giant", 31.588, 74.311, "location", "badshahi"),
        ],
      },
      pakistan: {
        id: "pakistan", title: "Pakistan", narration: "Land of the Indus.", artPrompt: "Mountains and a river.",
        image: { src: `${ART}-pk.svg`, alt: "Pakistan" },
        hotspots: [{ id: "k2", label: "K2", blurb: "A giant mountain", x: 50, y: 40, info: { title: "K2", body: ["Second highest."] } }],
      },
      lahore: {
        id: "lahore", title: "Lahore", narration: "The walled city.", artPrompt: "Bazaar and fort.",
        image: { src: `${ART}-lhr.svg`, alt: "Lahore" },
        hotspots: [{ id: "fort", label: "The Fort", blurb: "Old walls", x: 50, y: 50, info: { title: "Fort", body: ["Mughal walls."] } }],
      },
      badshahi: {
        id: "badshahi", title: "Badshahi Mosque", narration: "The imperial mosque.", artPrompt: "Red domes.",
        image: { src: `${ART}-bmq.svg`, alt: "Badshahi Mosque" },
        hotspots: [{ id: "courtyard", label: "The Courtyard", blurb: "Huge", x: 50, y: 50, info: { title: "Courtyard", body: ["Fits 100,000."] } }],
      },
    },
  };
}

async function seedGlobeTopic(title) {
  const id = `globe-child-${Date.now()}`;
  await getFirestore().collection("wikidoTopics").doc(id).set(globeTopic(id, title));
  return id;
}

test("a child explores a globe world: spin, zoom through the layers, and step inside places", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `Globe Atlas ${String(Date.now()).slice(-6)}`;
  await seedGlobeTopic(title);
  for (const suffix of ["pk", "lhr", "bmq"]) {
    await page.route(`https://example.com/globe-e2e-${suffix}.svg`, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg(suffix === "pk" ? "#366" : suffix === "lhr" ? "#636" : "#a63") })
    );
  }

  // a child account through the in-place gate — wikido needs no family setup
  await page.goto("/wikido");
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Globe Wanderer");
  await gate.getByLabel("Email").fill(uniqueEmail("globe"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");

  // the globe world wears its badge on the shelf and opens on the 3D Earth
  const card = page.locator(".wd-topic", { hasText: title });
  await expect(card.locator(".wd-topic-globe")).toBeVisible();
  await card.click();
  await expect(page.locator(".wd-globe")).toBeVisible();
  await expect(page.locator(".wd-title")).toHaveText(title);

  // country layer first; the deeper layers wait
  await expect(page.locator(".wd-hot", { hasText: "Pakistan" })).toBeVisible();
  await expect(page.locator(".wd-hot", { hasText: "Lahore" })).toHaveCount(0);
  await expect(page.locator(".wd-hot", { hasText: "Badshahi" })).toHaveCount(0);

  // tapping a country spot opens its card; step inside like any doorway
  await page.locator(".wd-hot", { hasText: "Pakistan" }).click();
  const info = page.locator(".wd-info");
  await expect(info).toBeVisible();
  await expect(info).toContainText("Fun fact!");
  await info.locator(".wd-enter").click();
  await expect(page.locator(".wd-scene")).toBeVisible();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan");
  await expect(page.locator(".wd-hot")).toHaveCount(1); // the place scene's fact spot

  // the crumb back to the hub returns to the globe
  await page.locator(".wd-crumb", { hasText: title }).click();
  await expect(page.locator(".wd-globe")).toBeVisible();

  // a double-click steps straight in
  await page.locator(".wd-hot", { hasText: "Pakistan" }).dblclick();
  await expect(page.locator(".wd-scene")).toBeVisible();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Pakistan");
  await page.locator(".wd-crumb", { hasText: title }).click();
  await expect(page.locator(".wd-globe")).toBeVisible();

  // zoom into the city band: the country pin HIDES, the city pin shows
  const zoomIn = page.locator('button[aria-label="Zoom in"]');
  for (let i = 0; i < 3; i += 1) await zoomIn.click();
  await expect(page.locator(".wd-hot", { hasText: "Lahore" })).toBeVisible();
  await expect(page.locator(".wd-hot", { hasText: "Pakistan" })).toHaveCount(0);
  await expect(page.locator(".wd-hot", { hasText: "Badshahi" })).toHaveCount(0);

  // zoom into the location band: the city pin hides too; the card opens in this view
  for (let i = 0; i < 2; i += 1) await zoomIn.click();
  await expect(page.locator(".wd-hot", { hasText: "Badshahi" })).toBeVisible();
  await expect(page.locator(".wd-hot", { hasText: "Lahore" })).toHaveCount(0);
  await page.locator(".wd-hot", { hasText: "Badshahi" }).click();
  const place = page.locator(".wd-info");
  await expect(place).toBeVisible();
  await expect(place).toContainText("Badshahi Mosque");
  await place.locator(".wd-enter").click();
  await expect(page.locator(".wd-scene")).toBeVisible();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Badshahi Mosque");

  // home returns to the shelf
  await page.locator(".wd-home").click();
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
});

test.describe("globe on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap a pin, drag from a pin without opening the card, zoom buttons only", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `Globe Phone ${String(Date.now()).slice(-6)}`;
  await seedGlobeTopic(title);
  for (const suffix of ["pk", "lhr", "bmq"]) {
    await page.route(`https://example.com/globe-e2e-${suffix}.svg`, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg("#366") })
    );
  }

  await page.goto("/wikido");
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Phone Wanderer");
  await gate.getByLabel("Email").fill(uniqueEmail("globe.phone"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");

  await page.locator(".wd-topic", { hasText: title }).click();
  await expect(page.locator(".wd-globe")).toBeVisible();

  // a tap on the country pin opens the card as a bottom sheet
  await page.locator(".wd-hot", { hasText: "Pakistan" }).tap();
  const info = page.locator(".wd-info");
  await expect(info).toBeVisible();
  // the zoom stack hides behind the open bottom sheet instead of covering it
  await expect(page.locator(".wd-zoom")).toBeHidden();
  await info.locator(".wd-enter").tap();
  await expect(page.locator(".wd-scene")).toBeVisible();
  await page.locator(".wd-crumb", { hasText: title }).tap();
  await expect(page.locator(".wd-globe")).toBeVisible();

  // zoom buttons reach the city layer on the phone too
  const zoomIn = page.locator('button[aria-label="Zoom in"]');
  for (let i = 0; i < 3; i += 1) await zoomIn.tap();
  await expect(page.locator(".wd-hot", { hasText: "Lahore" })).toBeVisible();
  await expect(page.locator(".wd-hot", { hasText: "Pakistan" })).toHaveCount(0);

  // a one-finger drag STARTING on a pin spins the planet — it must not open
  // the pin's card (a drag is not a tap)
  const lahore = page.locator(".wd-hot", { hasText: "Lahore" });
  const box = await lahore.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); // warm the hit target
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.locator(".wd-close").tap();
  await expect(page.locator(".wd-info")).toHaveCount(0);

  const start = await lahore.boundingBox();
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  // sweep the finger across the pin: down, travel, up
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const opts = (dx, dy) => ({
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true,
      clientX: x + dx, clientY: y + dy, buttons: 1,
    });
    el.dispatchEvent(new PointerEvent("pointerdown", opts(0, 0)));
    for (let i = 1; i <= 8; i += 1) el.dispatchEvent(new PointerEvent("pointermove", opts(i * 10, -i * 4)));
    el.dispatchEvent(new PointerEvent("pointerup", opts(80, -32)));
    el.dispatchEvent(new PointerEvent("pointercancel", opts(80, -32)));
  }, { x: cx, y: cy });
  await page.waitForTimeout(300);
  // the planet rotated (the pin is no longer under the finger) and no card opened
  await expect(page.locator(".wd-info")).toHaveCount(0);
  });
});

test("superadmin curates a globe world: pin bar, hub pad, and coordinate editing", async ({ page }) => {
  test.setTimeout(120_000);
  const id = `globe-studio-${Date.now()}`;
  const title = `Globe Studio Atlas ${id.slice(-6)}`;
  const email = `${id}@example.com`;
  const user = await getAuth().createUser({ email, password: "test123456" });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });
  const doc = getFirestore().collection("wikidoTopics").doc(id);
  await doc.set({ ...globeTopic(id, title), status: "draft", discoveryCount: 3 });
  await page.route(`${ART}-pk.svg`, (route) => route.fulfill({ contentType: "image/svg+xml", body: svg("#366") }));
  await page.route(`${ART}-lhr.svg`, (route) => route.fulfill({ contentType: "image/svg+xml", body: svg("#636") }));

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test123456");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  await page.getByLabel("Family name").fill("Globe Studio Family");
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

  await page.goto("/platform");
  await page.getByRole("button", { name: "Wikido Studio" }).click();
  await page.locator(".chip-main", { hasText: title }).click();

  // the globe workspace shows the pin bar; the hub opens with the live globe editor
  await expect(page.locator(".pin-place")).toBeVisible();
  await expect(page.locator(".pin-place input")).toBeVisible();
  await expect(page.locator(".wd-e")).toBeVisible();
  await expect(page.locator(".wd-e-pin")).toHaveCount(3);
  await expect(page.locator(".stage img")).toHaveCount(0); // no picture to paint for the hub

  // artwork counts skip the hub: every place scene already has generated art
  await expect(page.getByRole("button", { name: /Artwork complete/ })).toBeVisible();

  // the superadmin can relocate a place by dragging its pin on the globe —
  // optional fine-tuning; the gazetteer coordinates are pre-saved by default
  const pin = page.locator('.wd-e-pin[aria-label*="Pakistan"]');
  await pin.scrollIntoViewIfNeeded();
  const box = await pin.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".wd-e-readout")).toContainText("Pakistan");
  await expect(page.locator(".wd-e-readout")).toContainText("unsaved");

  // the list still edits level + coordinates numerically
  await page.locator(".spot-toggle", { hasText: "Lahore" }).click();
  const body = page.locator(".spot.selected");
  await expect(body.getByLabel(/Zoom level/)).toBeVisible();
  await expect(body.locator('input[type="number"]').first()).toHaveValue("31.55");
  await body.locator('input[type="number"]').first().fill("31.6");
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(page.locator(".note.ok").first()).toContainText("Saved", { timeout: 30_000 });

  const saved = (await doc.get()).data();
  const lahore = saved.scenes.globe.hotspots.find((h) => h.id === "lahore");
  expect(lahore.lat).toBe(31.6);
  expect(lahore.level).toBe("city");
  const pakistan = saved.scenes.globe.hotspots.find((h) => h.id === "pakistan");
  expect(pakistan.lng).toBeGreaterThan(69.3); // the pin drag moved it east…
  expect(pakistan.lat).toBeLessThan(30.4);    // …and south, persisted through save
  expect(saved.view).toBe("globe");

  // a place scene still edits as a picture
  await page.locator(".scene-main", { hasText: "Pakistan" }).click();
  await expect(page.locator(".stage img")).toBeVisible();
  await expect(page.locator(".pin-place").first()).toBeVisible(); // the pin bar stays available
});
