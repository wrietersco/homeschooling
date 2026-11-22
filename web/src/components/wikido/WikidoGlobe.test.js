import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// jsdom has no ResizeObserver and no canvas — the globe degrades to its DOM
// overlay (spots, cards, controls), which is what these tests exercise.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({ stop: vi.fn(), speak: vi.fn(), speakingId: { value: null } }),
}));
vi.mock("@/components/SpeakButton.vue", () => ({
  default: {
    name: "SpeakButton",
    props: ["text", "audioUrl"],
    template: "<button class='speak-stub' :data-audio='audioUrl'>listen</button>",
  },
}));

import WikidoGlobe from "./WikidoGlobe.vue";

// A synthetic globe world — exactly what the Studio's "pin a place" flow
// builds: a hub whose doorways are pinned places, each opening an image scene.
const placeScene = (id, title) => ({
  id,
  title,
  narration: `${title} awaits.`,
  image: { src: `https://example.com/${id}.jpg`, alt: title },
  hotspots: [{ id: "fact", label: "A fact", blurb: "b", x: 50, y: 50, info: { title: "T", body: ["p"] } }],
});
const pack = {
  id: "globe-fixture",
  title: "Globe Fixture",
  tagline: "Pinned places",
  view: "globe",
  rootSceneId: "globe",
  scenes: {
    globe: {
      id: "globe",
      title: "Globe Fixture",
      narration: "Spin the globe and tap a glowing place!",
      image: { src: "", alt: "globe" },
      hotspots: [
        { id: "pakistan", label: "Pakistan", blurb: "Mountains and the Indus", lat: 30.4, lng: 69.3, level: "country", countryId: "pk", childSceneId: "pakistan", info: { title: "Pakistan", body: ["A country in South Asia."], fact: "K2 is the second-highest mountain on Earth!" } },
        { id: "lahore", label: "Lahore", blurb: "City of gardens", lat: 31.55, lng: 74.34, level: "city", countryId: "pk", childSceneId: "lahore", info: { title: "Lahore", body: ["A city in Pakistan."] } },
        { id: "badshahi", label: "Badshahi Mosque", blurb: "A red-sandstone giant", lat: 31.588, lng: 74.311, level: "location", countryId: "pk", childSceneId: "badshahi", info: { title: "Badshahi Mosque", body: ["A grand mosque in Lahore."] } },
      ],
    },
    pakistan: placeScene("pakistan", "Pakistan"),
    lahore: placeScene("lahore", "Lahore"),
    badshahi: placeScene("badshahi", "Badshahi Mosque"),
  },
};
const hub = pack.scenes.globe;

const spotLabel = (w, name) => w.findAll(".wd-hot").find((h) => h.text().includes(name));

function mountGlobe() {
  const w = mount(WikidoGlobe, {
    props: { topic: pack, scene: hub, trail: [], topicDirectory: {} },
  });
  // give the sky a real size so spots get screen positions (jsdom reports 0)
  const el = w.find(".wd-sky").element;
  Object.defineProperties(el, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
  w.vm.resize();
  return w;
}

// face the Pakistan cluster at the outermost zoom
async function facePakistan(w) {
  w.vm.rot = { lambda: 72, phi: 25 };
  w.vm.setZoom(1);
  await flushPromises();
}

beforeEach(() => localStorage.clear());

describe("WikidoGlobe", () => {
  it("renders the hub welcome, chrome and zoom controls", () => {
    const w = mountGlobe();
    expect(w.find(".wd-title").text()).toBe("Globe Fixture");
    expect(w.find(".wd-narration").text()).toContain("Spin the globe");
    expect(w.find(".speak-stub").exists()).toBe(true);
    expect(w.find('button[aria-label="Zoom in"]').exists()).toBe(true);
    expect(w.find('button[aria-label="Zoom out"]').exists()).toBe(true);
    // zoomed out fully: zoom out is disabled, reset offered
    expect(w.find('button[aria-label="Zoom out"]').attributes("disabled")).toBeDefined();
    expect(w.find('button[aria-label="Reset view"]').exists()).toBe(true);
  });

  it("shows ONE layer at a time: zooming deeper hides the parent layer", async () => {
    const w = mountGlobe();
    await facePakistan(w);
    const visible = () => w.findAll(".wd-hot").map((h) => h.text());

    // zoomed out: the country layer only
    expect(visible().some((t) => t.includes("Pakistan"))).toBe(true);
    expect(visible().some((t) => t.includes("Lahore"))).toBe(false);
    expect(visible().some((t) => t.includes("Badshahi"))).toBe(false);

    // zoom into the city band: the country pin fades away, cities show
    w.vm.setZoom(3);
    await flushPromises();
    expect(visible().some((t) => t.includes("Lahore"))).toBe(true);
    expect(visible().some((t) => t.includes("Pakistan"))).toBe(false);
    expect(visible().some((t) => t.includes("Badshahi"))).toBe(false);

    // zoom into the location band: cities hide too
    w.vm.setZoom(5);
    await flushPromises();
    expect(visible().some((t) => t.includes("Badshahi"))).toBe(true);
    expect(visible().some((t) => t.includes("Lahore"))).toBe(false);
    expect(visible().some((t) => t.includes("Pakistan"))).toBe(false);

    // zoom back out: the country layer returns
    w.vm.setZoom(1);
    await flushPromises();
    expect(visible().some((t) => t.includes("Pakistan"))).toBe(true);
    expect(visible().some((t) => t.includes("Badshahi"))).toBe(false);
  });

  it("never shows a spot that has rotated to the far side of the planet", async () => {
    const w = mountGlobe();
    w.vm.rot = { lambda: -60, phi: -30 }; // staring at the Pacific
    await flushPromises();
    const visible = w.findAll(".wd-hot").map((h) => h.text());
    expect(visible.some((t) => t.includes("Pakistan"))).toBe(false);
    expect(visible.some((t) => t.includes("Lahore"))).toBe(false);
  });

  it("opens the info card when a spot is tapped and steps inside from it", async () => {
    const w = mountGlobe();
    await facePakistan(w);
    const pakistan = spotLabel(w, "Pakistan");
    expect(pakistan).toBeTruthy();
    await pakistan.trigger("click");
    await flushPromises();
    const card = w.find(".wd-info");
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("K2 is the second-highest");
    await card.find(".wd-enter").trigger("click");
    expect(w.emitted("enter")[0][0].id).toBe("pakistan");
    // tapping records the discovery
    const progress = JSON.parse(localStorage.getItem("wikido.progress.v1"));
    expect(progress["globe-fixture"]["hotspot:globe:pakistan"]).toBeTruthy();
  });

  it("steps straight in on double-click and marks the scene visited", async () => {
    const w = mountGlobe();
    await facePakistan(w);
    await spotLabel(w, "Pakistan").trigger("dblclick");
    await flushPromises();
    expect(w.emitted("enter")[0][0].childSceneId).toBe("pakistan");
    const progress = JSON.parse(localStorage.getItem("wikido.progress.v1"));
    expect(progress["globe-fixture"]["scene:globe"]).toBeTruthy();
  });

  it("zooms with the buttons and crosses a layer within two taps", async () => {
    const w = mountGlobe();
    await w.find('button[aria-label="Zoom in"]').trigger("click");
    expect(w.vm.zoom).toBeGreaterThan(1);
    await w.find('button[aria-label="Zoom in"]').trigger("click");
    await flushPromises();
    expect(w.vm.zoom).toBeGreaterThanOrEqual(1.35 * 1.35);
  });

  it("counts discoveries against the pinned places only", () => {
    const w = mountGlobe();
    expect(w.find(".wd-progress").text()).toMatch(new RegExp(`\\d+/${hub.hotspots.length}`));
  });

  it("exposes a programmatic zoom clamp for tests and power users", () => {
    const w = mountGlobe();
    w.vm.setZoom(1e15);
    expect(w.vm.zoom).toBeLessThanOrEqual(2e9);
    w.vm.setZoom(0.1);
    expect(w.vm.zoom).toBeGreaterThanOrEqual(1);
  });
});

describe("WikidoGlobe — switched-off places and continents", () => {
  const spotsWith = (extra) => ({
    ...pack,
    scenes: { ...pack.scenes, globe: { ...hub, hotspots: [...hub.hotspots, ...extra] } },
  });
  const mountWith = (extra) => {
    const topic = spotsWith(extra);
    const w = mount(WikidoGlobe, { props: { topic, scene: topic.scenes.globe, trail: [], topicDirectory: {} } });
    const el = w.find(".wd-sky").element;
    Object.defineProperties(el, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
    w.vm.resize();
    return w;
  };
  const off = { id: "india", label: "India", blurb: "b", lat: 22.4, lng: 79, level: "country", enabled: false, info: { title: "India", body: ["Coming soon."] } };
  const asia = { id: "asia", label: "Asia", blurb: "The biggest continent", lat: 45, lng: 90, level: "continent", childSceneId: "pakistan", info: { title: "Asia", body: ["The biggest continent."] } };

  it("never shows a switched-off place to children", async () => {
    const w = mountWith([off]);
    await facePakistan(w);
    expect(spotLabel(w, "Pakistan")).toBeTruthy();
    expect(spotLabel(w, "India")).toBeUndefined();
    // and it is not counted among the places to discover
    expect(w.find(".wd-progress").text()).toContain("/3");
  });

  it("with a continent pin, countries wait for the first zoom-in", async () => {
    const w = mountWith([asia]);
    w.vm.rot = { lambda: 85, phi: 35 };
    w.vm.setZoom(1);
    await flushPromises();
    expect(spotLabel(w, "Asia")).toBeTruthy();
    expect(spotLabel(w, "Pakistan")).toBeUndefined();
    w.vm.setZoom(2);
    await flushPromises();
    expect(spotLabel(w, "Pakistan")).toBeTruthy();
    expect(spotLabel(w, "Asia")).toBeUndefined();
  });
});

describe("WikidoGlobe initial view (regression: production showed no pins)", () => {
  it("shows enabled continent pins at the first zoom and hides switched-off ones", async () => {
    const p = structuredClone(pack);
    const h = p.scenes.globe.hotspots;
    h.push({ id: "asia", label: "Asia", blurb: "b", lat: 34, lng: 90, level: "continent", childSceneId: "pakistan", info: { title: "Asia", body: ["p"] } });
    h.push({ id: "russia", label: "Russia", blurb: "b", lat: 60, lng: 90, level: "continent", enabled: false, childSceneId: "pakistan", info: { title: "Russia", body: ["p"] } });
    const w = mount(WikidoGlobe, { props: { topic: p, scene: p.scenes.globe, trail: [], topicDirectory: {} } });
    const el = w.find(".wd-sky").element;
    Object.defineProperties(el, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
    w.vm.resize();
    w.vm.rot = { lambda: 80, phi: 35 };
    w.vm.setZoom(1);
    await flushPromises();
    expect(spotLabel(w, "Asia")).toBeTruthy();
    expect(spotLabel(w, "Russia")).toBeUndefined();
  });
  it("shows enabled country pins at the first zoom when the world has no continents", async () => {
    const w = mountGlobe();
    await facePakistan(w);
    expect(spotLabel(w, "Pakistan")).toBeTruthy();
  });
});

describe("WikidoGlobe deep-link state", () => {
  it("opens the card named by cardId and starts facing that place with no welcome drift", () => {
    const w = mount(WikidoGlobe, { props: { topic: pack, scene: hub, trail: [], topicDirectory: {}, cardId: "pakistan" } });
    expect(w.find(".wd-info").exists()).toBe(true);
    expect(w.vm.rot.lambda).toBeCloseTo(69.3, 1);
    expect(w.vm.rot.phi).toBeCloseTo(30.4, 1);
  });

  it("starts at the camera from ?at= and honours a folded narration panel", () => {
    const w = mount(WikidoGlobe, {
      props: { topic: pack, scene: hub, trail: [], topicDirectory: {}, camera: { lat: 31.5, lng: 74.3, zoom: 3 }, intro: false },
    });
    expect(w.vm.rot.lambda).toBeCloseTo(74.3, 1);
    expect(w.vm.zoom).toBeCloseTo(3, 1);
    expect(w.find(".wd-narration").exists()).toBe(false);
  });

  it("reports card and panel changes, and the camera only once the child moves it", async () => {
    const w = mountGlobe();
    w.vm.setZoom(2); // programmatic, before any interaction → no camera note
    await flushPromises();
    expect(w.emitted("camera")).toBeUndefined();
    await facePakistan(w);
    await spotLabel(w, "Pakistan").trigger("click");
    expect(w.emitted("card")?.at(-1)).toEqual(["pakistan"]);
    await w.find(".wd-intro-head").trigger("click");
    expect(w.emitted("intro")?.at(-1)).toEqual([false]);
    await w.find('button[aria-label="Zoom in"]').trigger("click");
    await flushPromises();
    expect(w.emitted("camera")?.length).toBeGreaterThan(0);
  });

  it("follows the URL: cardId changing closes the card", async () => {
    const w = mount(WikidoGlobe, { props: { topic: pack, scene: hub, trail: [], topicDirectory: {}, cardId: "pakistan" } });
    await w.setProps({ cardId: "" });
    expect(w.find(".wd-info").exists()).toBe(false);
    expect(w.emitted("card")).toBeUndefined(); // no echo back to the URL
  });
});
