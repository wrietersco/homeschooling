import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// jsdom has no ResizeObserver — the cover-placement composable degrades
// gracefully without it, but the global must exist.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const art = "https://example.com/a.png";
const topic = () => ({
  id: "space",
  title: "Space",
  emoji: "🚀",
  status: "draft",
  rootSceneId: "universe",
  discoveryCount: 2,
  scenes: {
    universe: {
      id: "universe", title: "The Universe", narration: "n", artPrompt: "p", image: { src: art, alt: "a" },
      hotspots: [
        { id: "galaxy", label: "What is a Galaxy?", blurb: "b", x: 20, y: 30, childSceneId: "galaxy-scene", info: { title: "t", body: ["x"] } },
        { id: "size", label: "How big?", blurb: "b", x: 70, y: 40, info: { title: "t", body: ["x"] } },
      ],
    },
    "galaxy-scene": {
      id: "galaxy-scene", title: "What is a Galaxy?", narration: "n", artPrompt: "p", image: { src: "", alt: "a" },
      hotspots: [{ id: "milky", label: "Milky Way", blurb: "b", x: 50, y: 50, info: { title: "t", body: ["x"] } }],
    },
  },
});

vi.mock("@/services/wikidoAdmin", () => ({
  generateWikidoTopic: vi.fn(),
  addWikidoChildScene: vi.fn(async () => ({ sceneId: "galaxy-scene", title: "Solar Flares", hotspots: 3 })),
  planWikidoOutline: vi.fn(async () => ({ trimmed: false, outline: [{ label: "Solar Flares", focus: "Eruptions", children: [{ label: "Flare Colours", focus: "x", children: [] }] }, { label: "Sunspots", focus: "Dark patches", children: [] }] })),
  suggestWikidoScenes: vi.fn(async () => ({ suggestions: [{ label: "Solar Flares", focus: "Eruptions", why: "Explosive!" }, { label: "Sunspots", focus: "Dark patches", why: "Cool" }] })),
  generateWikidoSceneImage: vi.fn(),
  generateWikidoImages: vi.fn(),
  adjustWikidoSpots: vi.fn(),
  adjustWikidoAllSpots: vi.fn(),
  saveWikidoTopic: vi.fn(),
  setWikidoTopicStatus: vi.fn(),
  deleteWikidoTopic: vi.fn(),
  fetchAllWikidoTopicsAdmin: vi.fn(async () => [topic()]),
  checkVoiceoverBridge: vi.fn(async () => ({ online: false })),
  synthesizeOnBridge: vi.fn(),
  planVoiceoverClips: vi.fn(() => []),
  attachWikidoAudio: vi.fn(),
  generateWikidoAudios: vi.fn(),
  requestWikidoKokoroJob: vi.fn(async () => ({ status: "done", total: 0, recorded: 0 })),
  stopWikidoKokoroJob: vi.fn(async () => ({ status: "cancelled" })),
  getWikidoKokoroJob: vi.fn(async () => ({ job: null })),
  startVoiceoverBridge: vi.fn(async () => ({ supported: false })),
  bridgeLauncherStatus: vi.fn(async () => ({ supported: false })),
  generateWikidoSpotDetails: vi.fn(async () => ({ spot: { label: "Written", blurb: "b", info: { title: "t", body: ["x"], fact: "f" } } })),
  planWikidoDepth: vi.fn(async () => ({ branches: [] })),
  planWikidoRelinks: vi.fn(async () => ({ moves: [] })),
  reorderWikidoTopics: vi.fn(),
  sortStudioTopics: (t) => t,
  BRIDGE_URL: "http://localhost:8787",
}));

vi.mock("@/services/admin", () => ({
  getLlmConfig: vi.fn(async () => ({ agents: { tts: { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" } } })),
}));

import WikidoStudio from "./WikidoStudio.vue";
import WikidoGlobeEditor from "./WikidoGlobeEditor.vue";
import { suggestWikidoScenes, addWikidoChildScene, planWikidoOutline, saveWikidoTopic, deleteWikidoTopic, fetchAllWikidoTopicsAdmin, adjustWikidoSpots, adjustWikidoAllSpots, planWikidoDepth, planWikidoRelinks, planVoiceoverClips, generateWikidoAudios, requestWikidoKokoroJob, stopWikidoKokoroJob, getWikidoKokoroJob, checkVoiceoverBridge, synthesizeOnBridge, attachWikidoAudio, startVoiceoverBridge, bridgeLauncherStatus } from "@/services/wikidoAdmin";

async function mountStudio() {
  const w = mount(WikidoStudio);
  await flushPromises();
  return w;
}

beforeEach(() => vi.clearAllMocks());

describe("WikidoStudio — plain-language editor", () => {
  it("selecting a scene updates the parent used to create deeper scenes", async () => {
    const w = await mountStudio();
    await w.findAll(".scene-main")[1].trigger("click");
    expect(w.find(".grow .pane-title").text()).toContain('What is a Galaxy?');
    expect(w.findAll(".scene-parent")[1].text()).toBe("Under The Universe");
    await w.find(".suggest .btn").trigger("click");
    await flushPromises();
    expect(suggestWikidoScenes).toHaveBeenCalledWith({ topicId: "space", parentSceneId: "galaxy-scene" });
  });
  it("explains the model in one line and uses one vocabulary", async () => {
    const w = await mountStudio();
    expect(w.find(".model-line").text()).toMatch(/map of scenes.*picture with spots.*shows a fact.*opens another scene.*opens another world/s);
    expect(w.text()).not.toMatch(/doorway|hotspot|layer/i);
  });

  it("shows numbered pins on the picture with a stated outcome for each spot", async () => {
    const w = await mountStudio();
    const pins = w.findAll(".pin");
    expect(pins.map((p) => p.text())).toEqual(["1", "2"]);
    expect(pins[0].classes()).toContain("scene");
    const outcomes = w.findAll(".spot .outcome").map((o) => o.text());
    expect(outcomes[0]).toContain("Opens “What is a Galaxy?”");
    expect(outcomes[1]).toContain("Shows a fact card");
  });

  it("clicking a pin opens that spot's editor with an explicit tap-result choice", async () => {
    const w = await mountStudio();
    await w.findAll(".pin")[1].trigger("pointerdown");
    await w.findAll(".pin")[1].trigger("pointerup");
    expect(w.find(".spot.selected .kind").text()).toMatch(/shows a fact card/);
    expect(w.find(".spot.selected .kind").text()).toMatch(/opens another scene/);
    expect(w.find(".spot.selected .kind").text()).toMatch(/ANOTHER world/);
  });

  it("points a spot at a scene inside ANOTHER world", async () => {
    const w = await mountStudio();
    await w.findAll(".pin")[1].trigger("pointerdown");
    await w.findAll(".pin")[1].trigger("pointerup");
    // the topic under edit is "space", so the bundled packs are the other worlds
    const worldRadio = w.findAll(".spot.selected .kind label").find((l) => /ANOTHER world/.test(l.text()));
    await worldRadio.find("input").setValue();
    await flushPromises();
    const selected = w.find(".spot.selected");
    const worldSelect = selected.find("select");
    expect(worldSelect.exists()).toBe(true);
    const options = worldSelect.findAll("option").map((o) => o.text());
    expect(options).toContain("Living Things");
    // the door defaults to the chosen world's entrance, and the outcome says so
    expect(selected.text()).toMatch(/step from this world straight into/);
    const outcomes = w.findAll(".spot .outcome").map((o) => o.text());
    expect(outcomes[1]).toMatch(/in the world “/);
    // switching back to a plain doorway clears the other-world target and
    // re-picks a scene inside THIS topic
    const sceneRadio = w.findAll(".spot.selected .kind label").find((l) => /opens another scene here/.test(l.text()));
    await sceneRadio.find("input").setValue();
    await flushPromises();
    expect(w.find(".spot.selected").text()).not.toMatch(/in the world/);
    expect(w.find(".spot.selected select").element.value).toBe("galaxy-scene");
  });

  it("flags scenes that need attention in the map and the health list", async () => {
    const w = await mountStudio();
    expect(w.find(".health-head").text()).toMatch(/1 thing to fix/);
    expect(w.findAll(".scene-row .status-dot").map((d) => d.classes()[1])).toEqual(["ready", "needs-artwork"]);
  });

  it("delete is scoped: states what happens to pointing spots before removing anything", async () => {
    const w = await mountStudio();
    await w.findAll(".scene-main")[1].trigger("click");
    await w.find(".danger-zone .btn").trigger("click");
    const plan = w.find(".modal .plan").text();
    expect(plan).toMatch(/will become plain fact spots/);
    expect(plan).toMatch(/No deeper scenes/);
    await w.findAll(".modal-actions .btn").find((b) => /Delete scene/.test(b.text())).trigger("click");
    expect(w.findAll(".scene-row")).toHaveLength(1);
    expect(w.findAll(".pin")[0].classes()).toContain("fact");
  });

  it("the root scene cannot be deleted and shows no delete button", async () => {
    const w = await mountStudio();
    expect(w.find(".danger-zone").exists()).toBe(false);
  });

  it("suggests scenes on request and one click creates the chosen one", async () => {
    const w = await mountStudio();
    await w.find(".suggest .btn").trigger("click");
    await flushPromises();
    expect(suggestWikidoScenes).toHaveBeenCalledWith({ topicId: "space", parentSceneId: "universe" });
    const chips = w.findAll(".chip");
    expect(chips.map((c) => c.find("strong").text())).toEqual(["＋ Solar Flares", "＋ Sunspots"]);
    await chips[0].trigger("click");
    await flushPromises();
    expect(addWikidoChildScene).toHaveBeenCalledWith({ topicId: "space", parentSceneId: "universe", label: "Solar Flares", focus: "Eruptions" });
  });

  describe("Topic Builder", () => {
    const builderBtn = (w, re) => w.findAll(".builder .btn").find((b) => re.test(b.text()));

    async function draft(w) {
      await builderBtn(w, /Draft an outline/).trigger("click");
      await flushPromises();
    }

    it("drafts an editable outline and creates nothing until Build is pressed", async () => {
      const w = await mountStudio();
      await draft(w);
      expect(planWikidoOutline).toHaveBeenCalledWith({ topicId: "space", parentSceneId: "universe", total: 6 });
      expect(w.findAll(".outline-row")).toHaveLength(3);
      expect(w.find(".outline").text()).toMatch(/Will create 3 scenes/);
      expect(addWikidoChildScene).not.toHaveBeenCalled();
    });

    it("removing a node removes its subtree from the plan", async () => {
      const w = await mountStudio();
      await draft(w);
      await w.findAll(".outline-row .spot-del")[0].trigger("click"); // Solar Flares + Flare Colours
      expect(w.findAll(".outline-row")).toHaveLength(1);
      expect(builderBtn(w, /Build 1 scene/).exists()).toBe(true);
    });

    it("builds in order under the right parents; a failure skips only its subtree", async () => {
      addWikidoChildScene.mockImplementation(async ({ label }) => {
        if (label === "Solar Flares") throw new Error("internal: The generated scene was incomplete");
        return { sceneId: "scene-" + label.toLowerCase().replace(/ /g, "-"), title: label, hotspots: 3 };
      });
      const w = await mountStudio();
      await draft(w);
      await builderBtn(w, /Build 3 scenes/).trigger("click");
      await flushPromises();
      const calls = addWikidoChildScene.mock.calls.map(([a]) => a.label);
      expect(calls).toEqual(["Solar Flares", "Sunspots", "Solar Flares"]); // One automatic retry; Flare Colours never attempted
      const log = w.find(".build-log").text();
      expect(log).toMatch(/1 built · 1 failed · 1 skipped/);
      expect(log).toMatch(/The generated scene was incomplete/);
      expect(log).toMatch(/skipped because its parent scene failed/);
    });

    it("undo removes exactly the built scenes and persists the result", async () => {
      addWikidoChildScene.mockImplementation(async ({ label }) => ({ sceneId: "galaxy-scene", title: label, hotspots: 3 }));
      saveWikidoTopic.mockResolvedValue({ discoveryCount: 1 });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const w = await mountStudio();
      await draft(w);
      await builderBtn(w, /Build 3 scenes/).trigger("click");
      await flushPromises();
      await builderBtn(w, /Undo this build/).trigger("click");
      await flushPromises();
      expect(saveWikidoTopic).toHaveBeenCalledTimes(1);
      const saved = saveWikidoTopic.mock.calls[0][0].pack;
      expect(Object.keys(saved.scenes)).toEqual(["universe"]);
      expect(saved.scenes.universe.hotspots.map((h) => h.id)).toEqual(["size"]);
    });
  });

  describe("Deleting a topic", () => {
    it("warns that files go too, then reports how many were removed", async () => {
      deleteWikidoTopic.mockResolvedValue({ deleted: true, filesDeleted: 7, filesFailed: false });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const w = await mountStudio();
      await w.find(".toolbar-actions .btn.danger").trigger("click");
      await flushPromises();
      expect(confirm.mock.calls[0][0]).toMatch(/artwork and voice recordings are permanently deleted/);
      expect(deleteWikidoTopic).toHaveBeenCalledWith({ topicId: "space" });
      expect(w.find(".note.ok").text()).toMatch(/along with its 7 artwork and audio files/);
    });

    it("says so plainly when some files could not be removed", async () => {
      deleteWikidoTopic.mockResolvedValue({ deleted: true, filesDeleted: 3, filesFailed: true });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const w = await mountStudio();
      await w.find(".toolbar-actions .btn.danger").trigger("click");
      await flushPromises();
      expect(w.find(".note.ok").text()).toMatch(/some of its files could not be removed/);
    });

    it("does nothing when the confirmation is declined", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const w = await mountStudio();
      await w.find(".toolbar-actions .btn.danger").trigger("click");
      expect(deleteWikidoTopic).not.toHaveBeenCalled();
    });
  });

  describe("re-parenting scenes", () => {
    // universe → [galaxy-scene → [milky-way], planets]
    const richTopic = () => ({
      id: "space", title: "Space", emoji: "🚀", status: "draft", rootSceneId: "universe", discoveryCount: 2,
      scenes: {
        universe: {
          id: "universe", title: "The Universe", narration: "n", artPrompt: "p", image: { src: art, alt: "a" },
          hotspots: [
            { id: "galaxy", label: "What is a Galaxy?", blurb: "b", x: 20, y: 30, childSceneId: "galaxy-scene", info: { title: "t", body: ["x"] } },
            { id: "planets-spot", label: "Planets", blurb: "b", x: 70, y: 40, childSceneId: "planets", info: { title: "t", body: ["x"] } },
          ],
        },
        "galaxy-scene": {
          id: "galaxy-scene", title: "What is a Galaxy?", narration: "n", artPrompt: "p", image: { src: art, alt: "a" },
          hotspots: [{ id: "milky", label: "Milky Way", blurb: "b", x: 50, y: 50, childSceneId: "milky-way", info: { title: "t", body: ["x"] } }],
        },
        "milky-way": { id: "milky-way", title: "The Milky Way", narration: "n", artPrompt: "p", image: { src: art, alt: "a" }, hotspots: [] },
        planets: { id: "planets", title: "Planets", narration: "n", artPrompt: "p", image: { src: art, alt: "a" }, hotspots: [] },
      },
    });

    it("the parent field names the current parent and re-parents with the deeper scenes along", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      const w = await mountStudio();
      await w.findAll(".scene-main")[1].trigger("click"); // What is a Galaxy?
      const sel = w.find(".parent-field select");
      expect(sel.exists()).toBe(true);
      expect(sel.element.value).toBe("universe");
      expect(w.find(".parent-note").text()).toMatch(/moves this scene and its 1 deeper scene along/);
      // its own branch can't become the parent: itself and its child are disabled
      const options = sel.findAll("option");
      expect(options.map((o) => o.element.disabled)).toEqual([false, true, true, false]); // universe, self, own child, planets
      await sel.setValue("planets");
      // DFS order now: universe → planets → galaxy-scene → milky-way
      const labels = w.findAll(".scene-parent").map((n) => n.text());
      expect(labels).toEqual(["Topic entrance", "Under The Universe", "Under Planets", "Under What is a Galaxy?"]);
      expect(w.find(".note.ok").text()).toMatch(/Moved under “Planets”, with its 1 deeper scene — save your edits/);
    });

    it("the entrance has no parent field — it cannot move", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      const w = await mountStudio();
      expect(w.find(".parent-field").exists()).toBe(false);
      expect(w.find(".parent-note").text()).toMatch(/The entrance always comes first/);
    });

    it("dropping a row onto another re-parents it", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      const w = await mountStudio();
      const grips = w.findAll(".drag-grip");
      await grips[3].trigger("dragstart", { dataTransfer: { effectAllowed: "move", setData: () => {} } }); // Planets
      const rows = w.findAll(".scene-row");
      await rows[1].trigger("dragover", { dataTransfer: { dropEffect: "none" } }); // onto What is a Galaxy?
      expect(rows[1].classes()).toContain("drop-into");
      await rows[1].trigger("drop", { dataTransfer: { getData: () => "planets" } });
      const labels = w.findAll(".scene-parent").map((n) => n.text());
      expect(labels).toEqual(["Topic entrance", "Under The Universe", "Under What is a Galaxy?", "Under What is a Galaxy?"]);
      expect(w.find(".note.ok").text()).toMatch(/Scene moved — remember to save your edits/);
    });

    it("dropping a scene under its own branch is refused (no drop target)", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      const w = await mountStudio();
      const grips = w.findAll(".drag-grip");
      await grips[1].trigger("dragstart", { dataTransfer: { effectAllowed: "move", setData: () => {} } }); // What is a Galaxy?
      const rows = w.findAll(".scene-row");
      await rows[2].trigger("dragover", { dataTransfer: { dropEffect: "none" } }); // onto its own child
      expect(rows[2].classes()).not.toContain("drop-into");
      await rows[2].trigger("drop", { dataTransfer: { getData: () => "galaxy-scene" } });
      expect(w.findAll(".scene-parent").map((n) => n.text())).toEqual(["Topic entrance", "Under The Universe", "Under What is a Galaxy?", "Under The Universe"]);
    });

    it("✦ Re-link moves a misplaced scene under its proper parent and reports why", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      planWikidoRelinks.mockResolvedValueOnce({
        moves: [{
          sceneId: "milky-way", parentSceneId: "planets",
          sceneTitle: "The Milky Way", parentTitle: "Planets",
          doorwayLabel: "Our galaxy from afar", reason: "galaxies sit beside planets",
        }],
      });
      const w = await mountStudio();
      await w.findAll("button").find((b) => /Re-link misplaced/.test(b.text())).trigger("click");
      await flushPromises();
      expect(planWikidoRelinks).toHaveBeenCalledWith({ topicId: "space" });
      // milky-way left "What is a Galaxy?" and now hangs under Planets:
      // DFS order is universe → galaxy-scene → planets → milky-way
      expect(w.findAll(".scene-parent").map((n) => n.text())).toEqual(["Topic entrance", "Under The Universe", "Under The Universe", "Under Planets"]);
      const report = w.find(".relink-report").text();
      expect(report).toContain("The Milky Way");
      expect(report).toContain("Planets");
      expect(report).toContain("galaxies sit beside planets");
      expect(report).toContain("now opens from");
      // the new doorway on Planets' picture is named after what the child finds
      await w.findAll(".scene-main")[2].trigger("click"); // Planets
      expect(w.find(".spot .spot-label").text()).toContain("Our galaxy from afar");
      expect(w.text()).toMatch(/review the map, then save/);
    });

    it("✦ Re-link reports when every scene is already where it belongs", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      planWikidoRelinks.mockResolvedValueOnce({ moves: [] });
      const w = await mountStudio();
      await w.findAll("button").find((b) => /Re-link misplaced/.test(b.text())).trigger("click");
      await flushPromises();
      expect(w.text()).toMatch(/every scene is already where it belongs/);
      expect(w.find(".relink-report").exists()).toBe(false);
    });

    it("a save blocked by an unreachable scene points at the re-link fix", async () => {
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([richTopic()]);
      const w = await mountStudio();
      // make an edit so Save edits is enabled (it only fires on unsaved changes)
      await w.find('label.field input[type="text"]').setValue("The Universe, renamed");
      saveWikidoTopic.mockRejectedValueOnce(new Error('invalid-argument: Fix these before saving: Scene "brain-our-senses" is unreachable from root "living-things-overview"'));
      await w.findAll("button").find((b) => b.text() === "Save edits").trigger("click");
      await flushPromises();
      expect(w.text()).toMatch(/is unreachable from root/);
      expect(w.text()).toMatch(/Re-link misplaced scenes” and it will be linked/);
    });
  });

  it("Add more depth takes an optional direction from the textbox", async () => {
    const w = await mountStudio();
    const input = w.find(".depth-direction");
    expect(input.attributes("placeholder")).toContain("Optional direction");
    await input.setValue("more about how animals sense the world");
    const depthBtn = () => w.findAll("button").find((b) => /Add more depth/.test(b.text()));
    await depthBtn().trigger("click");
    await flushPromises();
    expect(planWikidoDepth).toHaveBeenCalledWith({ topicId: "space", maxScenes: 3, hint: "more about how animals sense the world" });
    // empty textbox → no direction; the curator decides on its own
    planWikidoDepth.mockClear();
    await input.setValue("   ");
    await depthBtn().trigger("click");
    await flushPromises();
    expect(planWikidoDepth).toHaveBeenCalledWith({ topicId: "space", maxScenes: 3, hint: "" });
  });
});

describe("WikidoStudio — globe worlds", () => {
  const globeSpot = (id, label, lat, lng, level) => ({
    id, label, blurb: `The ${label} teaser.`, lat, lng, level, countryId: "pk",
    childSceneId: id,
    info: { title: label, body: [`About ${label}.`], fact: `A ${label} fact.` },
  });
  const globeTopicDoc = () => ({
    id: "atlas",
    title: "Studio Atlas",
    emoji: "🌍",
    status: "draft",
    view: "globe",
    rootSceneId: "globe",
    discoveryCount: 3,
    scenes: {
      globe: {
        id: "globe", title: "Studio Atlas", narration: "Spin me.", image: { src: "", alt: "globe" },
        hotspots: [
          globeSpot("pakistan", "Pakistan", 30.4, 69.3, "country"),
          globeSpot("lahore", "Lahore", 31.55, 74.34, "city"),
        ],
      },
      pakistan: { id: "pakistan", title: "Pakistan", narration: "n", artPrompt: "p", image: { src: art, alt: "a" }, hotspots: [{ id: "k2", label: "K2", blurb: "b", x: 50, y: 40, info: { title: "t", body: ["x"] } }] },
      lahore: { id: "lahore", title: "Lahore", narration: "n", artPrompt: "p", image: { src: art, alt: "a" }, hotspots: [{ id: "fort", label: "Fort", blurb: "b", x: 50, y: 50, info: { title: "t", body: ["x"] } }] },
    },
  });

  it("opens the hub on a live globe editor: borders, pins, and drag-to-relocate", async () => {
    fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([globeTopicDoc()]);
    const w = await mountStudio();
    const editor = w.findComponent(WikidoGlobeEditor);
    expect(editor.exists()).toBe(true);
    // give the editor a real size so the pins get screen positions
    const el = editor.find(".wd-e").element;
    Object.defineProperties(el, { clientWidth: { value: 400, configurable: true }, clientHeight: { value: 400, configurable: true } });
    editor.vm.resize();
    editor.vm.rot = { lambda: 72, phi: 25 };
    await flushPromises();
    expect(w.findAll(".wd-e-pin")).toHaveLength(2);

    // the hub has no picture stage
    expect(w.find(".stage").exists()).toBe(false);
    expect(w.text()).toContain("Places on the globe");

    // pins are numbered by the places list — click Pakistan's pin by name
    const pakPin = w.findAll(".wd-e-pin").find((b) => b.attributes("aria-label").includes("Pakistan"));
    await pakPin.trigger("pointerdown", { pointerId: 9, clientX: 200, clientY: 200, button: 0 });
    await pakPin.trigger("pointerup", { pointerId: 9, clientX: 200, clientY: 200 });
    await flushPromises();
    expect(w.find(".spot.selected").text()).toContain("Pakistan");

    // dragging the pin emits real lat/lng and the workspace marks it unsaved
    const pakPin2 = w.findAll(".wd-e-pin").find((b) => b.attributes("aria-label").includes("Pakistan"));
    await pakPin2.trigger("pointerdown", { pointerId: 10, clientX: 200, clientY: 200, button: 0 });
    await pakPin2.trigger("pointermove", { pointerId: 10, clientX: 214, clientY: 207 });
    await pakPin2.trigger("pointerup", { pointerId: 10, clientX: 214, clientY: 207 });
    await flushPromises();
    const spot = w.vm.form.scenes.globe.hotspots.find((h) => h.id === "pakistan");
    expect(spot.lng).toBeGreaterThan(69.3); // dragged east
    expect(spot.lat).toBeLessThan(30.4);    // …and south
    expect(w.find(".wd-e-readout").text()).toContain("unsaved");

    // the drag persists through the normal save path
    saveWikidoTopic.mockResolvedValue({ saved: true, discoveryCount: 3, repairs: [] });
    fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([globeTopicDoc()]);
    const saveBtn = w.findAll(".toolbar-actions .btn").find((b) => b.text().includes("Save edits"));
    await saveBtn.trigger("click");
    await flushPromises();
    const payload = saveWikidoTopic.mock.calls.at(-1)[0];
    const savedSpot = payload.pack.scenes.globe.hotspots.find((h) => h.id === "pakistan");
    expect(savedSpot.lng).toBe(spot.lng);
    expect(savedSpot.lat).toBe(spot.lat);
  });
});

describe("WikidoStudio — bundled worlds in the studio", () => {
  const bundledChip = (w, title) =>
    w.findAll(".topic-chip").filter((c) => c.find(".chip-status.bundled").exists())
      .find((c) => c.text().includes(title));

  it("lists the developer-authored worlds first, badged as bundled", async () => {
    const w = await mountStudio();
    const chips = w.findAll(".topic-chip");
    const bundled = chips.filter((c) => c.find(".chip-status.bundled").exists());
    // the real bundled registry ships two worlds: Living Things and the globe shell
    expect(bundled.length).toBe(2);
    expect(chips[0].text()).toContain("Living Things");
    expect(chips[1].text()).toContain("Our Amazing Earth");
    // the workspace still opens on a generated world — bundled ones are reference
    expect(w.find(".workspace h2").text()).toContain("Space");
  });

  it("opens a bundled world in the normal scene and spot editor", async () => {
    const w = await mountStudio();
    await bundledChip(w, "Living Things").find(".chip-main").trigger("click");
    await flushPromises();
    expect(w.find(".toolbar-actions").exists()).toBe(true);
    expect(w.findAll(".scene-main").length).toBeGreaterThanOrEqual(6);
    expect(w.findAll(".pin").length).toBe(6);
    expect(w.find(".stage img").attributes("src")).toContain("/wikido/living-things/");
    expect(w.text()).toContain("Save edits");
    expect(w.text()).toContain("Publish to families");
    // hand-authored artwork isn't a generated picture — auto-adjust stays off
    const adjust = w.findAll(".placement-tools button").find((b) => /Auto-adjust/.test(b.text()));
    expect(adjust.element.disabled).toBe(true);
    // and the topic-wide pass has nothing to read either
    const allAdjust = w.findAll("button").find((b) => /Auto-adjust all spots/.test(b.text()));
    expect(allAdjust.element.disabled).toBe(true);
    w.unmount();
  });

  it("saves the complete bundled pack under the original topic id and uses its saved override", async () => {
    const w = await mountStudio();
    await bundledChip(w, "Living Things").find(".chip-main").trigger("click");
    saveWikidoTopic.mockImplementationOnce(async ({ topicId, pack }) => {
      expect(topicId).toBe("living-things");
      expect(pack.status).toBe("draft");
      expect(pack.cover.src).toContain("/wikido/living-things/");
      expect(pack.artStyle).toBeTruthy();
      fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([{ ...pack, id: topicId }]);
      return { discoveryCount: 41 };
    });
    await w.findAll("button").find(b => b.text() === "Save edits").trigger("click");
    await flushPromises();
    expect(w.findAll(".topic-chip").filter(c => c.text().includes("Living Things"))).toHaveLength(1);
    expect(w.find(".workspace h2").text()).toContain("draft");
    expect(w.find(".stage img").exists()).toBe(true);
    w.unmount();
  });

});


describe("WikidoStudio — premium voiceovers (two options)", () => {
  const genBtn = (w) => w.findAll(".voiceover button").find((b) => /Generate/.test(b.text()));

  it("Generate audios records missing clips server-side — no bridge needed", async () => {
    planVoiceoverClips.mockReturnValueOnce([
      { id: "universe", text: "The Universe. n" },
      { id: "universe.size", text: "How big? x" },
    ]);
    generateWikidoAudios.mockResolvedValueOnce({
      results: [
        { id: "universe", url: "https://audio/universe.wav" },
        { id: "universe.size", url: "https://audio/universe.size.wav" },
      ],
      recorded: 2, failed: 0, stoppedEarly: false,
    });
    const w = await mountStudio();
    // the offline state is an action, not a dead end
    expect(w.find(".voiceover").text()).toMatch(/Bridge offline/);
    expect(genBtn(w).text()).toMatch(/Generate all 5 audios/); // 2 narrations + 3 spot cards
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(generateWikidoAudios).toHaveBeenCalledWith({ topicId: "space", clipIds: ["universe", "universe.size"], force: false });
    expect(w.find(".note.ok").text()).toMatch(/Premium audios attached: 2\/2/);
    w.unmount();
  });

  it("says so plainly when every clip already has a recording", async () => {
    planVoiceoverClips.mockReturnValueOnce([]);
    const w = await mountStudio();
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(generateWikidoAudios).not.toHaveBeenCalled();
    expect(w.find(".note.ok").text()).toMatch(/already has a voiceover/);
    w.unmount();
  });

  it("surfaces a dry speech pool instead of looping on it", async () => {
    planVoiceoverClips.mockReturnValueOnce([{ id: "universe", text: "The Universe. n" }]);
    generateWikidoAudios.mockResolvedValueOnce({
      results: [{ id: "universe", error: "Shared speech capacity reached for today." }],
      recorded: 0, failed: 1, stoppedEarly: true,
    });
    const w = await mountStudio();
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(generateWikidoAudios).toHaveBeenCalledTimes(1);
    expect(w.find(".note.ok").text()).toMatch(/Premium audios attached: 0\/1 · failed: universe/);
    w.unmount();
  });
});

describe("WikidoStudio — voice engine picker (premium vs paid premium)", () => {
  const genBtn = (w) => w.findAll(".voiceover button").find((b) => /Generate/.test(b.text()));

  it("offers both engines categorically and names the configured paid model", async () => {
    const w = await mountStudio();
    const options = w.findAll(".vo-option");
    expect(options).toHaveLength(2);
    expect(options[0].text()).toMatch(/Premium — Kokoro/);
    expect(options[0].text()).toMatch(/limitless/);
    expect(options[0].text()).toMatch(/on the platform's servers/); // no bridge, no browser load
    expect(options[1].text()).toMatch(/Paid premium — gemini-2.5-flash-preview-tts/);
    expect(options[1].text()).toMatch(/platform limits apply/);
    // the picker follows reality until the curator chooses: bridge down → paid
    expect(w.find('input[value="paid"]').element.checked).toBe(true);
    w.unmount();
  });

  it("picking Kokoro on production enqueues a server-side job — the tab can close", async () => {
    const w = await mountStudio(); // mount first: the topic watcher polls the job on load
    requestWikidoKokoroJob.mockResolvedValueOnce({ status: "running", total: 2, recorded: 1, failed: 0 });
    getWikidoKokoroJob.mockResolvedValueOnce({ job: { status: "running", total: 2, recorded: 1, failed: 0 } });
    await w.find('input[value="kokoro"]').setValue();
    await genBtn(w).trigger("click");
    await flushPromises();
    // one enqueue, no per-clip babysitting: the scheduled worker does the work
    expect(requestWikidoKokoroJob).toHaveBeenCalledWith({ topicId: "space", force: false });
    expect(generateWikidoAudios).not.toHaveBeenCalled();
    expect(synthesizeOnBridge).not.toHaveBeenCalled();
    const row = w.find(".vo-job");
    expect(row.text()).toMatch(/Recording with Kokoro on the platform's servers — 1\/2 clips/);
    expect(row.text()).toMatch(/Safe to close this tab/);
    expect(row.find("button").text()).toMatch(/Stop the queue/);
    w.unmount();
  });

  it("stopping the queue cancels server-side and keeps what was recorded", async () => {
    fetchAllWikidoTopicsAdmin.mockResolvedValue([topic()]);
    const w = await mountStudio(); // mount first: the topic watcher polls the job on load
    requestWikidoKokoroJob.mockResolvedValueOnce({ status: "running", total: 5, recorded: 2, failed: 0 });
    getWikidoKokoroJob.mockResolvedValueOnce({ job: { status: "running", total: 5, recorded: 2, failed: 0 } });
    getWikidoKokoroJob.mockResolvedValue({ job: { status: "cancelled", total: 5, recorded: 2, failed: 0 } });
    await w.find('input[value="kokoro"]').setValue();
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(w.find(".vo-job").text()).toMatch(/2\/5/);
    await w.find(".vo-job button").trigger("click");
    await flushPromises();
    expect(stopWikidoKokoroJob).toHaveBeenCalledWith({ topicId: "space" });
    expect(w.find(".note.ok").text()).toMatch(/Kokoro run stopped — 2\/5 clips were recorded/);
    expect(w.find(".vo-job").text()).toMatch(/Last Kokoro run: 2\/5 recorded · stopped early/);
    w.unmount();
  });

  it("says so plainly when the topic is already fully voiced", async () => {
    requestWikidoKokoroJob.mockResolvedValueOnce({ status: "done", total: 0, recorded: 0 });
    const w = await mountStudio();
    await w.find('input[value="kokoro"]').setValue();
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(w.find(".note.ok").text()).toMatch(/already has a voiceover/);
    w.unmount();
  });

  it("Start the bridge spawns the process and reports when the engine answers", async () => {
    startVoiceoverBridge.mockResolvedValueOnce({ supported: true, ok: true, pid: 4242 });
    // first probe (mount) sees offline; the poll after the spawn sees it up
    checkVoiceoverBridge.mockResolvedValueOnce({ online: false });
    checkVoiceoverBridge.mockResolvedValueOnce({ online: true, engine: "kokoro", voice: "af_heart", url: "http://localhost:8787" });
    const w = await mountStudio();
    const startBtn = () => w.findAll(".voiceover button").find((b) => /Start the bridge/.test(b.text()));
    expect(startBtn()).toBeTruthy();
    await startBtn().trigger("click");
    await vi.waitFor(() => expect(w.find(".note.ok").text()).toMatch(/Kokoro bridge is up \(pid 4242\)/), { timeout: 5000 });
    expect(startVoiceoverBridge).toHaveBeenCalledTimes(1);
    expect(generateWikidoAudios).not.toHaveBeenCalled(); // starting alone never bills anything
    expect(startBtn()).toBeUndefined(); // online — the launcher button is gone
    w.unmount();
  });

  it("reports a crashed bridge process truthfully instead of waiting forever", async () => {
    startVoiceoverBridge.mockResolvedValueOnce({ supported: true, ok: true, pid: 9 });
    bridgeLauncherStatus.mockResolvedValue({ supported: true, alive: false, pid: 9, exit: { code: 1 }, output: ["Error: listen EADDRINUSE"] });
    const w = await mountStudio();
    await w.findAll(".voiceover button").find((b) => /Start the bridge/.test(b.text())).trigger("click");
    await vi.waitFor(() => expect(w.find(".note.err").text()).toMatch(/bridge process exited \(code 1\)/), { timeout: 5000 });
    expect(w.find(".note.err").text()).toContain("EADDRINUSE"); // the bridge's own last words
    w.unmount();
  });

  it("with the bridge online, the Kokoro engine routes to the free bridge flow", async () => {
    checkVoiceoverBridge.mockResolvedValueOnce({ online: true, engine: "kokoro", voice: "af_heart", url: "http://localhost:8787" });
    planVoiceoverClips.mockReturnValueOnce([{ id: "universe", text: "The Universe. n" }]);
    synthesizeOnBridge.mockResolvedValueOnce({ results: [{ id: "universe", mp3: "QQ==" }], failed: [] });
    attachWikidoAudio.mockResolvedValue({ url: "https://audio/universe.mp3" });
    const w = await mountStudio();
    expect(w.find(".voiceover").text()).toMatch(/bridge online \(af_heart\)/);
    expect(w.find('input[value="kokoro"]').element.checked).toBe(true); // free engine auto-picked
    await genBtn(w).trigger("click");
    await flushPromises();
    expect(synthesizeOnBridge).toHaveBeenCalledWith("http://localhost:8787", [{ id: "universe", text: "The Universe. n" }]);
    expect(attachWikidoAudio).toHaveBeenCalledWith({ topicId: "space", sceneId: "universe", hotspotId: undefined, audioBase64: "QQ==", mime: "audio/mpeg" });
    expect(generateWikidoAudios).not.toHaveBeenCalled(); // the paid path stays untouched
    expect(w.find(".note.ok").text()).toMatch(/Voiceovers attached: 1\/1/);
    w.unmount();
  });
});

describe("WikidoStudio — visual spot placement", () => {
  async function stage() {
    const w = await mountStudio();
    const el = w.find(".stage").element;
    Object.defineProperties(el, { clientWidth: { value: 800 }, clientHeight: { value: 450 } });
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 450 });
    await w.find(".stage img").trigger("load");
    return w;
  }
  const pointer = (x, y, extra = {}) => ({ pointerId: 1, clientX: x, clientY: y, button: 0, ...extra });
  const saveBtn = (w) => w.findAll(".placement-tools button").find((b) => /Save spot positions/.test(b.text()));
  // the per-scene button says "✦ Auto-adjust spots"; the topic-wide one adds "all"
  const adjustBtn = (w) => w.findAll("button").find((b) => /✦ Auto-adjust spots$/.test(b.text().trim()));

  it("keeps the grabbed offset, ignores other pointers, and persists coordinates through the save control", async () => {
    const w = await stage();
    const pin = w.findAll(".pin")[0];
    await pin.trigger("pointerdown", pointer(267, 188)); // center 260,185 + grab offset
    await pin.trigger("pointermove", pointer(507, 278, { pointerId: 2 }));
    expect(w.find(".placement-status").text()).toBe("Positions saved");
    await pin.trigger("pointermove", pointer(507, 278));
    expect(w.find(".placement-status").text()).toContain("X 50%, Y 50%");
    expect(pin.attributes("style")).toContain("left: 400px");
    await pin.trigger("pointerup", pointer(507, 278));
    expect(w.find(".spot.selected").exists()).toBe(false);
    const saved = topic();
    saved.scenes.universe.hotspots[0].x = 50;
    saved.scenes.universe.hotspots[0].y = 50;
    saveWikidoTopic.mockResolvedValueOnce({ discoveryCount: 2 });
    fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([saved]);
    await saveBtn(w).trigger("click");
    await flushPromises();
    expect(saveWikidoTopic.mock.calls.at(-1)[0].pack.scenes.universe.hotspots[0]).toMatchObject({ x: 50, y: 50 });
    expect(w.find(".placement-status").text()).toBe("Spot positions saved.");
    expect(saveBtn(w).element.disabled).toBe(true);
    w.unmount();
  });

  it("restores the original coordinates when pointer capture is interrupted", async () => {
    const w = await stage();
    const pin = w.findAll(".pin")[0];
    await pin.trigger("pointerdown", pointer(260, 185));
    await pin.trigger("pointermove", pointer(900, 500));
    expect(w.find(".placement-status").text()).toContain("X 100%, Y 100%");
    await pin.trigger("pointercancel", pointer(900, 500));
    expect(pin.attributes("style")).toContain("left: 160px");
    expect(saveBtn(w).element.disabled).toBe(true);
    w.unmount();
  });

  it("leaves edits available for retry when saving fails", async () => {
    const w = await stage();
    const pin = w.findAll(".pin")[1];
    await pin.trigger("pointerdown", pointer(660, 230));
    await pin.trigger("pointerup", pointer(500, 275));
    saveWikidoTopic.mockRejectedValueOnce(new Error("Connection lost"));
    await saveBtn(w).trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Connection lost");
    expect(saveBtn(w).element.disabled).toBe(false);
    expect(pin.attributes("style")).toContain("left: 400px");
    w.unmount();
  });

  it("auto-adjust is enabled only once artwork exists, then the agent's coordinates move the pins", async () => {
    adjustWikidoSpots.mockResolvedValueOnce({
      placements: [{ id: "galaxy", x: 12, y: 24 }, { id: "size", x: 66, y: 58 }],
      placed: 2, total: 2,
    });
    const w = await stage();
    expect(adjustBtn(w).element.disabled).toBe(false);
    const before = w.findAll(".pin")[0].attributes("style");
    await adjustBtn(w).trigger("click");
    await flushPromises();
    expect(adjustWikidoSpots).toHaveBeenCalledWith({ topicId: "space", sceneId: "universe" });
    expect(w.findAll(".pin")[0].attributes("style")).not.toBe(before);
    expect(w.find(".placement-status").text()).toMatch(/Auto-adjusted 2 of 2 spots/);
    w.unmount();
  });

  it("auto-adjust stays disabled until the scene's picture is painted", async () => {
    const w = await mountStudio();
    await w.findAll(".scene-main")[1].trigger("click"); // the artwork-less scene
    await flushPromises();
    expect(adjustBtn(w).element.disabled).toBe(true);
    expect(adjustBtn(w).attributes("title")).toContain("generate the artwork first");
    w.unmount();
  });

  it("✦ Auto-adjust all spots re-places every generated scene and reloads the pins", async () => {
    fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([topic()]); // initial load
    adjustWikidoAllSpots.mockResolvedValueOnce({
      results: [{ sceneId: "universe", title: "The Universe", placed: 2, total: 2 }],
      adjusted: 1, failed: 0, skipped: 1, // galaxy-scene has no artwork yet
    });
    const adjusted = topic();
    adjusted.scenes.universe.hotspots[0].x = 11;
    adjusted.scenes.universe.hotspots[0].y = 24;
    adjusted.scenes.universe.hotspots[1].x = 66;
    adjusted.scenes.universe.hotspots[1].y = 58;
    fetchAllWikidoTopicsAdmin.mockResolvedValueOnce([adjusted]); // the post-run reload
    const w = await mountStudio();
    const before = w.findAll(".pin")[0].attributes("style");
    const allBtn = w.findAll("button").find((b) => /Auto-adjust all spots/.test(b.text()));
    await allBtn.trigger("click");
    await flushPromises();
    expect(adjustWikidoAllSpots).toHaveBeenCalledWith({ topicId: "space" });
    expect(w.findAll(".pin")[0].attributes("style")).not.toBe(before);
    expect(w.text()).toMatch(/Auto-adjusted 1 scene \(2 spots placed\); skipped 1 without generated artwork\./);
    w.unmount();
  });
});
