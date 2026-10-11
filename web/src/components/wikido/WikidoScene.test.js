import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import civilizations from "@/lib/wikido/topics/civilizations.js";

// The scene talks to the shared TTS composable (which drags Firebase in) — stub it.
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({ stop: vi.fn(), speak: vi.fn(), speakingId: { value: null } }),
}));
vi.mock("@/components/SpeakButton.vue", () => ({
  // Expose the props WikidoScene hands over so tests can assert the recorded
  // narration audio actually reaches the button (audioUrl wins over live TTS).
  default: {
    name: "SpeakButton",
    props: ["text", "audioUrl"],
    template: "<button class='speak-stub' :data-audio='audioUrl' :data-text='text'>listen</button>",
  },
}));

import WikidoScene from "./WikidoScene.vue";

const pack = civilizations;
const rootScene = pack.scenes[pack.rootSceneId];

function mountScene({ scene = rootScene, trail = [] } = {}) {
  return mount(WikidoScene, {
    props: { topic: pack, scene, trail },
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("WikidoScene", () => {
  it("renders every hotspot of the scene with its label", () => {
    const w = mountScene();
    const hots = w.findAll(".wd-hot");
    expect(hots).toHaveLength(rootScene.hotspots.length);
    for (const spot of rootScene.hotspots) {
      expect(hots.some((h) => h.text().includes(spot.label))).toBe(true);
    }
  });

  it("shows the scene narration and marks the scene as visited", () => {
    const w = mountScene();
    expect(w.find(".wd-title").text()).toBe(rootScene.title);
    expect(w.find(".wd-narration").text()).toContain("civilization");
    // the Read-to-me button receives the scene's recorded narration clip
    expect(w.find(".speak-stub").attributes("data-audio")).toBe(rootScene.audio || "");
    const progress = JSON.parse(localStorage.getItem("wikido.progress.v1"));
    expect(progress.civilizations[`scene:${rootScene.id}`]).toBeTruthy();
  });

  it("opens the info card when a hotspot is tapped and records the discovery", async () => {
    const w = mountScene();
    await w.findAll(".wd-hot")[0].trigger("click");
    await flushPromises();
    const card = w.find(".wd-info");
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain(rootScene.hotspots[0].info.title);
    expect(card.text()).toContain("Fun fact!");
    const progress = JSON.parse(localStorage.getItem("wikido.progress.v1"));
    expect(progress.civilizations[`hotspot:${rootScene.id}:${rootScene.hotspots[0].id}`]).toBeTruthy();
    // seen badge now shows on the hotspot
    expect(w.find(".wd-hot").classes()).toContain("seen");
  });

  it("offers 'Step inside' only for hotspots with a child scene and emits enter", async () => {
    const w = mountScene();
    // first hotspot ("What is a Civilization?") is a leaf
    await w.findAll(".wd-hot")[0].trigger("click");
    await flushPromises();
    expect(w.find(".wd-enter").exists()).toBe(false);

    // the "Great Empires" hotspot drills into the Persian Empire
    const empires = rootScene.hotspots.find((h) => h.id === "empires");
    await w.findAll(".wd-hot").find((h) => h.text().includes("Great Empires")).trigger("click");
    await flushPromises();
    const enterBtn = w.find(".wd-enter");
    expect(enterBtn.exists()).toBe(true);
    await enterBtn.trigger("click");
    expect(w.emitted("enter")[0][0].id).toBe(empires.id);
  });

  it("steps straight into a doorway hotspot on double-click", async () => {
    const w = mountScene();
    const empires = rootScene.hotspots.find((h) => h.id === "empires");
    await w.findAll(".wd-hot").find((h) => h.text().includes("Great Empires")).trigger("dblclick");
    await flushPromises();
    expect(w.emitted("enter")[0][0].id).toBe(empires.id);
    // a leaf hotspot never navigates, even on double-click
    await w.findAll(".wd-hot")[0].trigger("dblclick");
    expect(w.emitted("enter")).toHaveLength(1);
  });

  it("closes the info card via the close button", async () => {
    const w = mountScene();
    await w.findAll(".wd-hot")[0].trigger("click");
    await flushPromises();
    await w.find(".wd-close").trigger("click");
    expect(w.find(".wd-info").exists()).toBe(false);
  });

  it("renders breadcrumb trail ancestors as navigation buttons", async () => {
    const w = mountScene({
      scene: pack.scenes["persian-empire"],
      trail: [{ sceneId: pack.rootSceneId, title: rootScene.title }],
    });
    const crumbs = w.findAll(".wd-crumb");
    expect(crumbs[0].text()).toBe(rootScene.title);
    expect(w.find(".wd-crumb.current").text()).toBe("Persian Empire & Persepolis");
    await crumbs[0].trigger("click");
    expect(w.emitted("navigate")[0][0]).toBe(pack.rootSceneId);
  });

  it("shows the discovered/total counter across the whole topic", () => {
    const w = mountScene();
    const total = Object.values(pack.scenes).reduce((n, sc) => n + sc.hotspots.length, 0);
    // the counter also holds a Material icon ligature; match the "n/total" tail
    expect(w.find(".wd-progress").text()).toMatch(new RegExp(`\\d+/${total}`));
  });
});
