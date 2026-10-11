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
  saveWikidoTopic: vi.fn(),
  setWikidoTopicStatus: vi.fn(),
  deleteWikidoTopic: vi.fn(),
  fetchAllWikidoTopicsAdmin: vi.fn(async () => [topic()]),
  checkVoiceoverBridge: vi.fn(async () => ({ online: false })),
  synthesizeOnBridge: vi.fn(),
  planVoiceoverClips: vi.fn(() => []),
  attachWikidoAudio: vi.fn(),
  generateWikidoSpotDetails: vi.fn(async () => ({ spot: { label: "Written", blurb: "b", info: { title: "t", body: ["x"], fact: "f" } } })),
  planWikidoDepth: vi.fn(async () => ({ branches: [] })),
  reorderWikidoTopics: vi.fn(),
  sortStudioTopics: (t) => t,
  BRIDGE_URL: "http://localhost:8787",
}));

import WikidoStudio from "./WikidoStudio.vue";
import { suggestWikidoScenes, addWikidoChildScene, planWikidoOutline, saveWikidoTopic, deleteWikidoTopic } from "@/services/wikidoAdmin";

async function mountStudio() {
  const w = mount(WikidoStudio);
  await flushPromises();
  return w;
}

beforeEach(() => vi.clearAllMocks());

describe("WikidoStudio — plain-language editor", () => {
  it("explains the model in one line and uses one vocabulary", async () => {
    const w = await mountStudio();
    expect(w.find(".model-line").text()).toMatch(/map of scenes.*picture with spots.*shows a fact.*opens another scene/s);
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
      expect(calls).toEqual(["Solar Flares", "Sunspots"]); // Flare Colours never attempted
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
});
