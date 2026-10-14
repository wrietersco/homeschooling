import { test, expect } from "@playwright/test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
if (!getApps().length) initializeApp({ projectId: "homeschooling-b3e57" });

test("superadmin drags numbered spots, saves, and reloads their artwork coordinates", async ({ page }) => {
  test.setTimeout(120_000);
  const id = `placement-${Date.now()}`;
  const email = `${id}@example.com`;
  const user = await getAuth().createUser({ email, password: "test123456" });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });
  const doc = getFirestore().collection("wikidoTopics").doc(id);
  await doc.set({ id, title: id, tagline: "Placement test", emoji: "🌍", status: "draft", rootSceneId: "root", discoveryCount: 1,
    scenes: { root: { id: "root", title: "Placement artwork", narration: "Explore this picture.", artPrompt: "A square picture",
      image: { src: "https://example.com/placement-art.svg", alt: "Square test artwork" },
      hotspots: [
        { id: "spot", label: "Drag me", blurb: "Explore", x: 20, y: 40, info: { title: "A fact", body: ["Details."] } },
        { id: "mammals", label: "Mammals", blurb: "Explore mammals", x: 80, y: 50, childSceneId: "mammals", info: { title: "Mammals", body: ["Mammals feed their young milk."] } },
        { id: "living-things", label: "Living Things", blurb: "Explore nature", x: 50, y: 60, childSceneId: "living-things-overview", info: { title: "Nature", body: ["Visit another world."] } },
      ] },
      mammals: { id: "mammals", title: "Mammal scene", narration: "Mammals", image: { src: "https://example.com/placement-art.svg", alt: "Mammals" }, hotspots: [{ id: "milk", label: "Milk", blurb: "Milk", x: 50, y: 50, info: { title: "Milk", body: ["Milk feeds young mammals."] } }] },
      orphan: { id: "orphan", title: "Previously deleted Mammals", narration: "Removed", image: { src: "https://example.com/placement-art.svg", alt: "Removed" }, hotspots: [{ id: "fact", label: "Fact", blurb: "Fact", x: 50, y: 50, info: { title: "Fact", body: ["Removed branch."] } }] },
    } });
  await page.route("https://example.com/placement-art.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#366"/></svg>' }));
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("test123456");
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await page.getByLabel("Family name").fill("Placement family");
    await page.getByRole("button", { name: "Create family" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    const open = async () => {
      await page.goto("/platform");
      await page.getByRole("button", { name: "Wikido Studio" }).click();
      await page.locator(".chip-main", { hasText: id }).click();
      await expect(page.locator(".stage img")).toBeVisible();
      await expect.poll(() => page.locator(".stage img").evaluate(img => img.naturalWidth)).toBe(1000);
      await page.locator(".stage").scrollIntoViewIfNeeded();
    };
    await open();
    // no local bridge in this environment — the voiceover section must still
    // offer the paid premium "Generate audios" action instead of a dead end
    await expect(page.locator(".voiceover")).toContainText("Bridge offline");
    await expect(page.getByRole("button", { name: /Generate all \d+ audios/ })).toBeEnabled();
    const pin = page.getByRole("button", { name: "Spot 1: Drag me", exact: true });
    const stage = page.locator(".stage");
    const box = await stage.boundingBox();
    const before = await pin.boundingBox();
    // A square source is cropped vertically in the 16:9 frame. The inverse
    // mapping must save picture percentages, rather than frame percentages.
    const targetX = box.x + box.width * .6;
    const targetY = box.y + box.height / 2 + box.width * .05;
    await page.mouse.move(before.x + before.width / 2 + 5, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX + 5, targetY, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(".placement-status")).toContainText("X 60%, Y 55%");
    await expect(page.locator(".spot.selected")).toHaveCount(0);
    await page.getByRole("button", { name: "Save spot positions", exact: true }).click();
    await expect(page.locator(".placement-status")).toHaveText("Spot positions saved.", { timeout: 20_000 });
    const saved = (await doc.get()).data().scenes.root.hotspots[0];
    expect(saved.x).toBe(60);
    expect(saved.y).toBe(55);
    const repaired = (await doc.get()).data();
    expect(repaired.scenes.orphan).toBeUndefined();
    expect(repaired.scenes.root.hotspots.find(h => h.id === "living-things").childTopicId).toBe("living-things");
    expect((await doc.collection("editBackups").get()).size).toBe(1);
    await open();
    const restored = await pin.boundingBox();
    const frame = await stage.boundingBox();
    expect(restored.x + restored.width / 2).toBeCloseTo(frame.x + frame.width * .6, 0);
    expect(restored.y + restored.height / 2).toBeCloseTo(frame.y + frame.height / 2 + frame.width * .05, 0);
    // The stage was created asynchronously: resizing must still track its box.
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect.poll(async () => {
      const p = await pin.boundingBox(), f = await stage.boundingBox();
      return Math.abs(p.x + p.width / 2 - f.x - f.width * .6);
    }).toBeLessThan(1);
    await page.screenshot({ path: "test-results/wikido-pin-placement.png", fullPage: false });
    await page.locator(".scene-main", { hasText: "Mammal scene" }).click();
    await page.getByRole("button", { name: "Delete this scene…", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete scene", exact: true }).click();
    await page.getByRole("button", { name: "Save edits", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save edits", exact: true })).toBeDisabled({ timeout: 20_000 });
    expect((await doc.get()).data().scenes.mammals).toBeUndefined();
    await page.getByRole("button", { name: "Publish to families", exact: true }).click();
    await expect(page.locator(".ws-toolbar .status-pill")).toHaveText("published", { timeout: 20_000 });
    await open();
    await expect(page.locator(".scene-main", { hasText: "Mammal scene" })).toHaveCount(0);
  } finally {
    await doc.delete();
    await getAuth().deleteUser(user.uid);
  }
});


test("bundled worlds can be edited, saved, published, and explored without duplicate shelf entries", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `bundled-${Date.now()}@example.com`;
  const user = await getAuth().createUser({ email, password: "test123456" });
  await getAuth().setCustomUserClaims(user.uid, { platformRole: "superadmin" });
  const doc = getFirestore().collection("wikidoTopics").doc("living-things");
  const previous = await doc.get();
  await doc.delete();
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("test123456");
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await page.getByLabel("Family name").fill("Bundled editor family");
    await page.getByRole("button", { name: "Create family" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await page.goto("/platform");
    await page.getByRole("button", { name: "Wikido Studio" }).click();
    await page.locator(".chip-main", { hasText: "Living Things" }).click();
    await expect(page.locator(".stage img")).toBeVisible();
    await expect(page.locator(".stage img")).toHaveAttribute("src", /\/wikido\/living-things\//);
    await expect(page.locator(".workspace")).toContainText("0 awaiting artwork");
    const title = page.locator(".scene-editor input").first();
    await title.fill("Living Things edited in Studio");
    await page.getByRole("button", { name: "Save edits", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save edits", exact: true })).toBeDisabled({ timeout: 20_000 });
    expect((await doc.get()).data().status).toBe("draft");
    expect((await doc.get()).data().scenes["living-things-overview"].title).toBe("Living Things edited in Studio");
    await page.getByRole("button", { name: "Publish to families", exact: true }).click();
    await expect(page.locator(".ws-toolbar .status-pill")).toHaveText("published", { timeout: 20_000 });
    expect((await doc.get()).data().status).toBe("published");
    await page.reload();
    await page.getByRole("button", { name: "Wikido Studio" }).click();
    await page.locator(".chip-main", { hasText: "Living Things" }).click();
    await expect(page.locator(".scene-editor input").first()).toHaveValue("Living Things edited in Studio");
    // Activate this test family to exercise the student explorer's normal guard.
    const families = await getFirestore().collection("families").get();
    for (const family of families.docs) {
      await family.ref.collection("billing").doc("subscription").set({ planId: "basic", status: "active", endsAt: new Date(Date.now() + 86400000), startsAt: new Date(Date.now() - 86400000), paymentStatus: "paid", currency: "PKR", agreedPrice: 4500 });
    }
    await page.goto("/wikido");
    await expect(page.locator(".wd-topic", { hasText: "Living Things" })).toHaveCount(1);
    await page.locator(".wd-topic", { hasText: "Living Things" }).click();
    await expect(page.locator(".wd-scene")).toContainText("Living Things edited in Studio");
  } finally {
    if (previous.exists) await doc.set(previous.data());
    else await doc.delete();
    await getAuth().deleteUser(user.uid);
  }
});
