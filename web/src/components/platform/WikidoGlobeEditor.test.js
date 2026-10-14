import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// jsdom has no ResizeObserver and no canvas — the editor's DOM overlay (pins,
// buttons, readout) is what these tests exercise.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

import WikidoGlobeEditor from "./WikidoGlobeEditor.vue";

const spots = () => [
  { id: "pakistan", label: "Pakistan", blurb: "b", lat: 30.4, lng: 69.3, level: "country", childSceneId: "pakistan", info: { title: "t", body: ["p"] } },
  { id: "lahore", label: "Lahore", blurb: "b", lat: 31.55, lng: 74.34, level: "city", childSceneId: "lahore", info: { title: "t", body: ["p"] } },
];

function mountEditor() {
  const w = mount(WikidoGlobeEditor, {
    props: { spots: spots(), selectedId: "" },
  });
  const el = w.find(".wd-e").element;
  Object.defineProperties(el, { clientWidth: { value: 400, configurable: true }, clientHeight: { value: 400, configurable: true } });
  const canvas = w.find(".wd-e-planet").element;
  Object.defineProperties(canvas, {
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 400, height: 400 }), configurable: true },
  });
  w.vm.resize();
  return w;
}

// face the Pakistan cluster so both pins are on the visible disk
async function faceCluster(w) {
  w.vm.rot = { lambda: 72, phi: 25 };
  await flushPromises();
}

const pin = (w, name) => w.findAll(".wd-e-pin").find((b) => b.attributes("aria-label").includes(name));

describe("WikidoGlobeEditor", () => {
  it("renders every pinned place as a numbered, level-tinted pin", async () => {
    const w = mountEditor();
    await faceCluster(w);
    const pins = w.findAll(".wd-e-pin");
    expect(pins).toHaveLength(2);
    expect(pin(w, "Pakistan").classes()).toContain("lvl-country");
    expect(pin(w, "Lahore").classes()).toContain("lvl-city");
  });

  it("hides pins that rotate to the far side", async () => {
    const w = mountEditor();
    w.vm.rot = { lambda: -60, phi: -30 };
    await flushPromises();
    expect(w.findAll(".wd-e-pin")).toHaveLength(0);
  });

  it("emits select when a pin is clicked (without dragging)", async () => {
    const w = mountEditor();
    await faceCluster(w);
    const target = pin(w, "Pakistan");
    const box = { left: 200, top: 180, width: 26, height: 26 };
    target.element.getBoundingClientRect = () => box;
    await target.trigger("pointerdown", { pointerId: 3, clientX: 213, clientY: 193, button: 0 });
    await target.trigger("pointerup", { pointerId: 3, clientX: 213, clientY: 193 });
    expect(w.emitted("select")[0][0]).toBe("pakistan");
    expect(w.emitted("relocate")).toBeUndefined();
  });

  it("emits relocate with real lat/lng when a pin is dragged", async () => {
    const w = mountEditor();
    await faceCluster(w);
    const target = pin(w, "Pakistan");
    target.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 26, height: 26 });
    // Pakistan sits at the centre of this view: project it to screen px first
    const centre = { x: 0, y: 0 };
    const start = { x: 200, y: 190 };
    Object.defineProperty(target.element, "getBoundingClientRect", {
      value: () => ({ left: start.x - 13 + centre.x, top: start.y - 13 + centre.y, width: 26, height: 26 }),
    });

    // drag ~28 px right and ~14 px down — a small, real relocation
    await target.trigger("pointerdown", { pointerId: 4, clientX: start.x, clientY: start.y, button: 0 });
    for (let i = 1; i <= 4; i += 1) {
      await target.trigger("pointermove", { pointerId: 4, clientX: start.x + i * 7, clientY: start.y + i * 3.5 });
    }
    await target.trigger("pointerup", { pointerId: 4, clientX: start.x + 28, clientY: start.y + 14 });

    const moves = w.emitted("relocate");
    expect(moves.length).toBeGreaterThan(0);
    const [id, lat, lng] = moves.at(-1);
    expect(id).toBe("pakistan");
    // the drag moved the pin right (east) and down (south) on screen
    expect(lng).toBeGreaterThan(69.3);
    expect(lat).toBeLessThan(30.4);
    // the readout says what moved and that it is unsaved
    expect(w.find(".wd-e-readout").text()).toContain("Pakistan");
    expect(w.find(".wd-e-readout").text()).toContain("unsaved");
  });

  it("exposes a clamped programmatic zoom for tests", () => {
    const w = mountEditor();
    w.vm.setZoom(99);
    expect(w.vm.zoom).toBeLessThanOrEqual(6);
    w.vm.setZoom(0.1);
    expect(w.vm.zoom).toBeGreaterThanOrEqual(1);
  });
});

beforeEach(() => localStorage.clear());
