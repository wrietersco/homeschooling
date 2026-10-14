import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import livingThings from "@/lib/wikido/topics/living-things.js";

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

const pack = livingThings;
const rootScene = pack.scenes[pack.rootSceneId];
// A synthetic cross-topic doorway: no bundled world carries one, but the
// explorer's world-door treatment still needs coverage.
const doorScene = {
  id: "meadow-edge",
  title: "Meadow Edge",
  image: { src: "/wikido/x.svg", alt: "A meadow edge" },
  narration: "A scene with a door to another world.",
  hotspots: [
    {
      id: "door-to-astronomy",
      label: "Visit the Stars",
      blurb: "Step into another world",
      x: 20,
      y: 30,
      childTopicId: "astronomy",
      childSceneId: "space-overview",
      info: { title: "A doorway", body: ["This door leads to another world."] },
    },
  ],
};
const doorPack = { ...pack, scenes: { ...pack.scenes, "meadow-edge": doorScene } };

function mountScene({ scene = rootScene, pack: topic = pack, trail = [], topicDirectory = null } = {}) {
  return mount(WikidoScene, {
    props: { topic, scene, trail, topicDirectory },
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
    expect(w.find(".wd-narration").text()).toContain("crowded with life");
    // the Read-to-me button receives the scene's recorded narration clip
    expect(w.find(".speak-stub").attributes("data-audio")).toBe(rootScene.audio || "");
    const progress = JSON.parse(localStorage.getItem("wikido.progress.v1"));
    expect(progress["living-things"][`scene:${rootScene.id}`]).toBeTruthy();
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
    expect(progress["living-things"][`hotspot:${rootScene.id}:${rootScene.hotspots[0].id}`]).toBeTruthy();
    // seen badge now shows on the hotspot
    expect(w.find(".wd-hot").classes()).toContain("seen");
  });

  it("offers 'Step inside' only for hotspots with a child scene and emits enter", async () => {
    const w = mountScene();
    // first hotspot ("The Signs of Life") is a leaf
    await w.findAll(".wd-hot")[0].trigger("click");
    await flushPromises();
    expect(w.find(".wd-enter").exists()).toBe(false);

    // the "Kinds of Living Things" hotspot drills into the groups of life
    const kinds = rootScene.hotspots.find((h) => h.id === "kinds");
    await w.findAll(".wd-hot").find((h) => h.text().includes("Kinds of Living Things")).trigger("click");
    await flushPromises();
    const enterBtn = w.find(".wd-enter");
    expect(enterBtn.exists()).toBe(true);
    await enterBtn.trigger("click");
    expect(w.emitted("enter")[0][0].id).toBe(kinds.id);
  });

  it("steps straight into a doorway hotspot on double-click", async () => {
    const w = mountScene();
    const kinds = rootScene.hotspots.find((h) => h.id === "kinds");
    await w.findAll(".wd-hot").find((h) => h.text().includes("Kinds of Living Things")).trigger("dblclick");
    await flushPromises();
    expect(w.emitted("enter")[0][0].id).toBe(kinds.id);
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
      scene: pack.scenes["human-body"],
      trail: [{ topicId: "living-things", sceneId: pack.rootSceneId, title: rootScene.title }],
    });
    const crumbs = w.findAll(".wd-crumb");
    expect(crumbs[0].text()).toBe(rootScene.title);
    expect(w.find(".wd-crumb.current").text()).toBe("The Human Body");
    await crumbs[0].trigger("click");
    // the crumb carries its world identity so journeys spanning topics navigate
    expect(w.emitted("navigate")[0][0]).toEqual({ topicId: "living-things", sceneId: pack.rootSceneId, title: rootScene.title });
  });

  it("marks a cross-topic doorway and steps into the other world", async () => {
    const w = mountScene({
      scene: doorScene,
      pack: doorPack,
      topicDirectory: { astronomy: { title: "Astronomy" } },
    });
    const hot = w.findAll(".wd-hot").find((h) => h.text().includes(doorScene.hotspots[0].label));
    expect(hot.classes()).toContain("cross");

    await hot.trigger("click");
    await flushPromises();
    const card = w.find(".wd-info");
    expect(card.text()).toContain("A doorway to another world");
    const enterBtn = card.find(".wd-enter");
    expect(enterBtn.text()).toContain("Step into Astronomy");
    await enterBtn.trigger("click");
    expect(w.emitted("enter")[0][0].id).toBe(doorScene.hotspots[0].id);
  });

  it("keeps a cross-topic doorway dormant while its world is missing", async () => {
    const w = mountScene({ scene: doorScene, pack: doorPack, topicDirectory: {} });
    const hot = w.findAll(".wd-hot").find((h) => h.text().includes(doorScene.hotspots[0].label));
    await hot.trigger("click");
    await flushPromises();
    const card = w.find(".wd-info");
    expect(card.text()).toContain("isn't open yet");
    expect(card.find(".wd-enter").exists()).toBe(false);
    // and a double-click never enters a dormant door
    await hot.trigger("dblclick");
    expect(w.emitted("enter")).toBeUndefined();
  });

  it("shows the discovered/total counter across the whole topic", () => {
    const w = mountScene();
    const total = Object.values(pack.scenes).reduce((n, sc) => n + sc.hotspots.length, 0);
    // the counter also holds a Material icon ligature; match the "n/total" tail
    expect(w.find(".wd-progress").text()).toMatch(new RegExp(`\\d+/${total}`));
  });

  it("keeps the pins at their picture percentages inside the artwork layer", () => {
    // the pins live inside the pannable layer, positioned by raw percentages —
    // so they stay glued to their object wherever the layer is panned
    const w = mountScene();
    w.findAll(".wd-hot").forEach((pin, i) => {
      const spot = rootScene.hotspots[i];
      expect(pin.attributes("style")).toContain(`left: ${spot.x}%`);
      expect(pin.attributes("style")).toContain(`top: ${spot.y}%`);
    });
    w.unmount();
  });

  it("on phones enlarges the picture past the screen and pans it with one finger", async () => {
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query === "(max-width: 939px)",
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const w = mountScene();
      const el = w.find(".wd-art").element;
      Object.defineProperties(el, { clientWidth: { value: 390 }, clientHeight: { value: 700 } });
      await w.find(".wd-layer img").trigger("load"); // (re)measures the box
      const layer = w.find(".wd-layer");
      // 16:9 artwork at 1.25× cover-fit of 390×700 overflows BOTH axes…
      const width = parseFloat(layer.attributes("style").match(/width: (\d+)px/)[1]);
      const height = parseFloat(layer.attributes("style").match(/height: (\d+)px/)[1]);
      expect(width).toBeGreaterThan(390);
      expect(height).toBeGreaterThan(700);
      // …and the narration card starts folded so it never hides the picture
      expect(w.find(".wd-intro-body").exists()).toBe(false);
      // a one-finger drag pans the layer — the finger drags left/up, the
      // picture follows it, revealing what was off-screen. No scrollbars.
      await w.find(".wd-art").trigger("pointerdown", { pointerId: 1, clientX: 200, clientY: 350, button: 0 });
      await w.find(".wd-art").trigger("pointermove", { pointerId: 1, clientX: 140, clientY: 320 });
      expect(layer.attributes("style")).toContain("translate(-60px, -30px)");
      // the drag's trailing click never opens a spot
      await w.find(".wd-hot").trigger("click");
      expect(w.find(".wd-card").exists()).toBe(false);
      w.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
