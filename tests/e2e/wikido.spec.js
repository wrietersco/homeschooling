import { test, expect } from "@playwright/test";

// Wikido (/wikido) — immersive picture encyclopedia. Wikido is open: any
// signed-in account plays immediately (no family, onboarding, or subscription
// needed), and a shared link shows the in-place sign-in gate. Covers the gate,
// the Games-menu entry, the topic shelf, hotspot exploration, and the
// drill-down breadcrumb trail (Living Things → Types of Animals). Cross-topic
// world-doors have no bundled content any more — the explorer's door behaviour
// is covered by the WikidoScene unit tests, the publish-gate repair by the
// studio spec.

function uniqueEmail(tag) {
  return `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

// The app gates family pages on an active learning package (router guard →
// getMySubscription), and billing docs are superadmin-only by security rules.
// E2E runs against the Firestore emulator, so activate every family there via
// the admin SDK — which bypasses rules and only ever touches emulator data.
async function activateEmulatorSubscriptions() {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "homeschooling-b3e57" });
  const db = getFirestore(app);
  const now = Date.now();
  const families = await db.collection("families").get();
  const batch = db.batch();
  for (const family of families.docs) {
    batch.set(family.ref.collection("billing").doc("subscription"), {
      planId: "basic",
      status: "active",
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 30 * 86_400_000),
      agreedPrice: 4500,
      currency: "PKR",
      paymentStatus: "paid",
      updatedAt: new Date(),
    });
  }
  await batch.commit();
}

async function registerAndOnboard(page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(uniqueEmail("wikido"));
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Family name").fill("Wikido Test");
  await page.getByRole("button", { name: "Create family" }).click();
  // the guard may land the fresh (unsubscribed) family on /subscription first
  await page.waitForURL(/\/(dashboard|subscription)$/, { timeout: 15_000 });
  await activateEmulatorSubscriptions();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test("a shared /wikido link shows the quick sign-in gate in place (no login redirect)", async ({ page }) => {
  await page.goto("/wikido");
  // the visitor stays on /wikido — no bounce to /login
  await expect(page).toHaveURL(/\/wikido$/);
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await expect(gate.locator(".wd-gate-title")).toHaveText("Wikido");
  // both doors are right there: sign in, or create an account — plus Google
  await expect(gate.getByRole("button", { name: /Sign in & explore/ })).toBeVisible();
  await expect(gate.getByRole("button", { name: "Create an account" })).toBeVisible();
  await expect(gate.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("an existing account signs in through the gate and lands straight on the shelf", async ({ page }) => {
  const email = uniqueEmail("gate.in");
  // create the account first via the regular login page
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  // sign out so the shared-link flow can be exercised from scratch
  await page.locator("header.nav").getByRole("button", { name: "Sign out" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Sign in" }).waitFor();

  await page.goto("/wikido");
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByLabel("Email").fill(email);
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Sign in & explore/ }).click();
  // instant entry: the shelf is the very next screen, still on /wikido
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");
  await expect(page).toHaveURL(/\/wikido$/);
});

test("signing up through the gate is instantly playable — no family, onboarding, or subscription", async ({ page }) => {
  await page.goto("/wikido");
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Gate Wanderer");
  await gate.getByLabel("Email").fill(uniqueEmail("gate.up"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();

  // the shelf is the very next screen — never onboarding, never /subscription
  await expect(page).toHaveURL(/\/wikido$/);
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");

  // and the account is fully playable: open a world, step through a doorway
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.locator(".wd-title")).toHaveText("Living Things");
  await expect(page.locator(".wd-hot")).toHaveCount(6);
  await page.getByRole("button", { name: /Kinds of Living Things/ }).click();
  await page.locator(".wd-enter").click();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
});

test("a family without an active subscription still plays wikido", async ({ page }) => {
  await page.goto("/wikido");
  const gate = page.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Unsubscribed Parent");
  await gate.getByLabel("Email").fill(uniqueEmail("gate.sub"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");

  // give the account a family (onboarding) but never activate a subscription
  await page.goto("/onboarding");
  await page.getByLabel("Family name").fill("No Billing Family");
  await page.getByRole("button", { name: "Create family" }).click();
  await page.waitForURL(/\/(dashboard|subscription)$/, { timeout: 15_000 });
  // other pages would bounce to /subscription — wikido must not
  await page.goto("/wikido");
  await expect(page).toHaveURL(/\/wikido$/);
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.locator(".wd-title")).toHaveText("Living Things");
  await expect(page.locator(".wd-hot")).toHaveCount(6);
});

test("shelf opens from the Games menu and hides the app nav (immersive)", async ({ page }) => {
  await registerAndOnboard(page);
  await page.locator("header.nav").getByRole("button", { name: "Games" }).click();
  await page.locator("header.nav").getByRole("link", { name: "Wikido" }).click();
  await expect(page).toHaveURL(/\/wikido$/);
  // immersive route: the app nav is gone, the Wikido shelf is up
  await expect(page.locator("header.nav")).toHaveCount(0);
  await expect(page.locator(".wd-shelf-title")).toHaveText("Wikido");
  // the bundled world is on the shelf exactly once (studio-published worlds
  // may share the shelf on a long-lived emulator — duplicates may not)
  await expect(page.locator(".wd-topic", { hasText: "Living Things" })).toHaveCount(1);
});

test("child explores the Living Things topic and drills into Types of Animals", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.locator(".wd-title")).toHaveText("Living Things");

  // every hotspot of the overview scene is on screen
  await expect(page.locator(".wd-hot")).toHaveCount(6);

  // a leaf hotspot opens its info card (no "Step inside")
  await page.getByRole("button", { name: /Signs of Life/ }).click();
  const card = page.locator(".wd-info");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Fun fact!");
  await expect(card.locator(".wd-enter")).toHaveCount(0);
  await card.locator(".wd-close").click();
  await expect(card).toHaveCount(0);

  // the "Kinds of Living Things" hotspot steps into the groups of life
  await page.getByRole("button", { name: /Kinds of Living Things/ }).click();
  await page.locator(".wd-enter").click();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Kinds of Living Things");
  await expect(page.locator(".wd-hot")).toHaveCount(6);

  // a double-click on a doorway hotspot steps straight in (no info card stop)
  await page.getByRole("button", { name: /^Animals/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Types of Animals");
  await expect(page.locator(".wd-hot")).toHaveCount(7);

  // drilled to the bottom: "Mammals" is a leaf, so even a double-click stays
  await page.getByRole("button", { name: /^Mammals/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Types of Animals");
  // use the breadcrumb to come back up
  await page.locator(".wd-crumb", { hasText: "Living Things" }).first().click();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Living Things");
  // leaving via home returns to the shelf
  await page.locator(".wd-home").click();
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
});

test("child explores Living Things down to the Human Body", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.locator(".wd-title")).toHaveText("Living Things");

  // overview → Human Beings → the body, one doorway at a time (double-click
  // steps straight in)
  await page.getByRole("button", { name: /Human Beings/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("Human Beings");
  await expect(page.locator(".wd-hot")).toHaveCount(6);
  await page.getByRole("button", { name: /Your Amazing Body/ }).dblclick();
  await expect(page.locator(".wd-crumb.current")).toHaveText("The Human Body");
  await expect(page.locator(".wd-hot")).toHaveCount(8);

  // back to the shelf
  await page.locator(".wd-home").click();
  await expect(page.locator(".wd-shelf-title")).toBeVisible();
});

test("discovery progress survives a reload", async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await page.getByRole("button", { name: /Signs of Life/ }).click();
  await expect(page.locator(".wd-info")).toBeVisible();
  await page.reload();
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.locator(".wd-progress")).toContainText("1/");
  await expect(page.locator(".wd-hot.seen")).toHaveCount(1);
});

test("student music plays softly, survives scene changes, ducks for speech and remembers mute", async ({ page }) => {
  test.setTimeout(120_000);
  // Observe real browser media elements without mocking playback or decoding.
  await page.addInitScript(() => {
    window.__wikidoAudio = [];
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); window.__wikidoAudio.push(this); }
    };
  });
  await registerAndOnboard(page);
  await page.goto("/wikido");
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  const music = () => page.evaluate(() => {
    const audio = window.__wikidoAudio.find((a) => a.src.includes("/wikido/music/"));
    return audio ? { src: audio.src, volume: audio.volume, paused: audio.paused, time: audio.currentTime } : null;
  });
  await expect.poll(async () => (await music())?.paused).toBe(false);
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(0);
  await expect.poll(async () => (await music())?.volume).toBeCloseTo(0.12, 2);
  const first = (await music()).src;
  await page.getByRole("button", { name: /Kinds of Living Things/ }).click();
  await page.locator(".wd-enter").click();
  await expect(page.locator(".wd-crumb.current")).toContainText("Kinds of Living Things");
  expect((await music()).src).toBe(first);
  await expect.poll(async () => (await music())?.paused).toBe(false);

  await page.getByRole("button", { name: "Read to me" }).click();
  await expect.poll(async () => (await music())?.volume).toBeCloseTo(0.025, 2);
  await page.getByRole("button", { name: "Read to me" }).click();
  await expect.poll(async () => (await music())?.volume).toBeCloseTo(0.12, 2);

  await page.getByLabel("Music options", { exact: true }).click();
  await page.getByLabel("Music play mode").selectOption("repeat");
  await page.evaluate(() => window.__wikidoAudio.find((a) => a.src.includes("/wikido/music/")).dispatchEvent(new Event("ended")));
  expect((await music()).src).toBe(first);
  await page.getByLabel("Music play mode").selectOption("shuffle");
  await page.getByRole("button", { name: "Next track" }).click();
  await expect.poll(async () => (await music())?.src).not.toBe(first);
  await expect.poll(async () => (await music())?.paused).toBe(false);
  await page.getByText("Music credits", { exact: true }).click();
  await expect(page.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
  await page.screenshot({ path: "test-results/wikido-music-controls.png" });

  // Every downloaded asset must decode as real audio in the browser.
  const durations = await page.evaluate(async () => {
    const ids = ["aurora", "reverie", "first-snow", "permafrost"];
    return Promise.all(ids.map((id) => new Promise((resolve, reject) => {
      const audio = new Audio(`/wikido/music/${id}.mp3`);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => { resolve(audio.duration); audio.removeAttribute("src"); audio.load(); };
      audio.onerror = () => reject(new Error(`${id} did not decode`));
    })));
  });
  for (const duration of durations) expect(duration).toBeGreaterThan(120);
  await page.getByRole("button", { name: "Mute background music" }).click();
  await expect.poll(async () => (await music())?.paused).toBe(true);
  await page.locator(".wd-home").click();
  await expect(page.locator(".wd-music")).toHaveCount(0);
  await page.reload();
  await page.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(page.getByRole("button", { name: "Play background music" })).toBeVisible();
  await expect.poll(async () => (await music())?.paused).toBe(true);
  await page.getByRole("button", { name: "Play background music" }).click();
  await expect.poll(async () => (await music())?.paused).toBe(false);
});

test("a shared link + quick gate works on a phone-sized viewport, and the world plays", async ({ page, browser }) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 900 } });
  const small = await context.newPage();
  // the gate replaces the old "use a big screen" notice: phones explore directly
  await small.goto("/wikido");
  const gate = small.locator(".wd-gate");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Your name").fill("Phone Wanderer");
  await gate.getByLabel("Email").fill(uniqueEmail("wikido.small"));
  await gate.getByLabel("Password").fill("test123456");
  await gate.getByRole("button", { name: /Create account & explore/ }).click();
  await expect(small.locator(".wd-shelf-title")).toHaveText("Wikido");
  // the explorer works at phone size: every overview hotspot is present
  await small.locator(".wd-topic", { hasText: "Living Things" }).click();
  await expect(small.locator(".wd-title")).toHaveText("Living Things");
  await expect(small.locator(".wd-hot")).toHaveCount(6);
  await context.close();
});
