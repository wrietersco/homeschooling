import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";

// jsdom has no ResizeObserver / canvas — the mini globe falls back to its DOM overlay.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
HTMLCanvasElement.prototype.getContext = () => null;

import WikidoAddPlaceWizard from "./WikidoAddPlaceWizard.vue";
import { globeDirectory, buildPlaceholderGlobeSpot } from "../../../../functions/lib/wikidoGlobe.js";

// A tiny globe world + the same callbacks the studio hands the wizard.
function setup(hotspots = [], scenes = {}, extra = {}) {
  const pack = reactive({
    view: "globe",
    rootSceneId: "hub",
    scenes: { hub: { id: "hub", hotspots }, ...scenes },
  });
  const calls = { make: [], saved: 0 };
  const props = {
    pack,
    get directory() { return globeDirectory(pack); },
    topicStatus: "published",
    start: {},
    isDirty: false,
    ensureSpot: (place) => {
      if (!pack.scenes.hub.hotspots.find((h) => h.id === place.spotId)) pack.scenes.hub.hotspots.push(buildPlaceholderGlobeSpot(place));
      return place.spotId;
    },
    makeScene: vi.fn(async (query) => {
      calls.make.push(query);
      const spot = pack.scenes.hub.hotspots[0];
      spot.childSceneId = "s1";
      pack.scenes.s1 = { id: "s1", image: { src: "" } };
      return { spot };
    }),
    setEnabled: (id, on) => {
      const spot = pack.scenes.hub.hotspots.find((h) => h.id === id);
      if (on && !spot.childSceneId) return false;
      if (on) delete spot.enabled; else spot.enabled = false;
      return true;
    },
    relocate: vi.fn(),
    saveNow: vi.fn(async () => { calls.saved += 1; return true; }),
    paintArt: vi.fn(async () => null),
    recordVoice: vi.fn(async () => null),
    publish: vi.fn(async () => {}),
    ...extra,
  };
  const wrapper = mount(WikidoAddPlaceWizard, { props, attachTo: document.body });
  return { wrapper, pack, props, calls };
}

const body = () => document.body.textContent.replace(/\s+/g, " ");
const click = async (label) => {
  const btn = [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(label));
  expect(btn, `button “${label}”`).toBeTruthy();
  btn.click();
  await flushPromises();
};
const nextBtn = () => [...document.body.querySelectorAll(".wz-foot button")].find((b) => /Next|Looks right|Finish/.test(b.textContent));

describe("AddPlaceWizard", () => {
  it("walks a country from kind to a finished, switched-on place", async () => {
    const { wrapper, pack, calls, props } = setup();
    expect(body()).toContain("Step 1 of 5");
    expect(nextBtn().disabled).toBe(true);
    expect(body()).toContain("Choose a kind of place");

    await click("Country");
    expect(nextBtn().disabled).toBe(false);
    await click("Next");

    // step 2: pick from the catalog; Next stays disabled until chosen
    expect(body()).toContain("Step 2 of 5");
    expect(nextBtn().disabled).toBe(true);
    await click("Pakistan");
    await click("Next");

    // step 3: the pin exists, switched off, at the catalog coordinates
    expect(body()).toContain("Check the spot");
    expect(pack.scenes.hub.hotspots[0]).toMatchObject({ id: "pakistan", enabled: false, level: "country" });
    await click("Looks right");

    // step 4: write the scene
    expect(body()).toContain("Make its scene");
    expect(nextBtn().disabled).toBe(true);
    await click("Write the scene");
    expect(calls.make).toEqual(["Pakistan"]);
    expect(nextBtn().disabled).toBe(false);
    await click("Next");

    // step 5: switch on, finish → saved + finish screen
    expect(body()).toContain("Turn it on for children");
    document.body.querySelector(".wz-switch input").click();
    await flushPromises();
    expect(pack.scenes.hub.hotspots[0].enabled).toBeUndefined();
    props.isDirty = true;
    await wrapper.setProps({ isDirty: true });
    await click("Finish");
    expect(props.saveNow).toHaveBeenCalled();
    expect(body()).toContain("is on the globe for children");
    expect(body()).toContain("Paint its artwork");
    wrapper.unmount();
  });

  it("greys out places already on the globe and requires a country for a city", async () => {
    const done = { id: "japan", label: "Japan", level: "country", lat: 36, lng: 138, childSceneId: "j1", info: { title: "J", body: ["j"] } };
    const { wrapper } = setup([done], { j1: { id: "j1", image: { src: "" } } });
    await click("Country");
    await click("Next");
    const row = [...document.body.querySelectorAll(".wz-row")].find((b) => b.textContent.includes("Japan"));
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain("already on your globe");

    await click("Back");
    await click("City");
    await click("Next");
    expect(body()).toContain("First choose which country");
    expect(nextBtn().disabled).toBe(true);
    wrapper.unmount();
  });

  it("offers adding without a scene, and keeps the pin off", async () => {
    const { wrapper, pack, calls } = setup();
    await click("Continent");
    await click("Next");
    await click("Asia");
    await click("Next");
    await click("Looks right");
    await click("Add without a scene for now");
    expect(calls.saved).toBe(1);
    // nothing to switch on without a scene: straight to the summary
    expect(body()).toContain("All done");
    expect(body()).toContain("no scene yet");
    expect(pack.scenes.hub.hotspots[0].enabled).toBe(false);
    wrapper.unmount();
  });

  it("shows friendly errors and lets the scene be retried", async () => {
    const make = vi.fn().mockRejectedValueOnce(new Error("internal: Set the GEMINI_API_KEY secret.")).mockImplementation(async () => {
      const spot = {};
      return { spot };
    });
    const { wrapper } = setup([], {}, { makeScene: make });
    await click("Country");
    await click("Next");
    await click("Pakistan");
    await click("Next");
    await click("Looks right");
    await click("Write the scene");
    expect(body()).toContain("writing assistant is not set up");
    expect(body()).toContain("Try again");
    wrapper.unmount();
  });

  it("reopens a half-finished place at its first incomplete step", async () => {
    const spot = buildPlaceholderGlobeSpot({ spotId: "egypt", name: "Egypt", lat: 26, lng: 30, level: "country", countryId: "eg" });
    const { wrapper } = setup([spot], {}, { start: { spotId: "egypt" } });
    await flushPromises();
    expect(body()).toContain("Make its scene");
    expect(body()).toContain("Step 4 of 5");
    wrapper.unmount();
  });

  it("drops the unused pin when the curator goes back and picks another place", async () => {
    const { wrapper, pack } = setup([], {}, { discardSpot: (id) => { const h = pack.scenes.hub.hotspots; const i = h.findIndex((x) => x.id === id); if (i >= 0) h.splice(i, 1); } });
    await click("Continent");
    await click("Next");
    await click("Asia");
    await click("Next");
    expect(pack.scenes.hub.hotspots.map((h) => h.id)).toEqual(["asia"]);
    await click("Back");
    await click("Africa");
    await click("Next");
    expect(pack.scenes.hub.hotspots.map((h) => h.id)).toEqual(["africa"]);
    wrapper.unmount();
  });

  it("keeps a city linked to the country it was chosen in", async () => {
    const { wrapper, pack } = setup();
    await click("City");
    await click("Next");
    const sel = document.body.querySelector(".wz select");
    sel.value = "eg";
    sel.dispatchEvent(new Event("change"));
    await flushPromises();
    await click("Cairo");
    await click("Next");
    const cairo = pack.scenes.hub.hotspots.find((h) => h.label === "Cairo");
    expect(cairo.countryId).toBe("eg");
    wrapper.unmount();
  });

  it("does not claim success when publishing fails", async () => {
    const { wrapper } = setup([], {}, { topicStatus: "draft", publish: vi.fn(async () => "Some voiceovers failed.") });
    await click("Continent");
    await click("Next");
    await click("Asia");
    await click("Next");
    await click("Looks right");
    await click("Add without a scene for now");
    await click("Publish to families");
    expect(body()).toContain("Some voiceovers failed.");
    expect(body()).not.toContain("Published — families");
    wrapper.unmount();
  });
});
