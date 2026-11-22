// Perspectives across the web side: child loader (validation + pruning),
// loose scenes, the studio tree and scene deletion.
import { describe, expect, it } from "vitest";
import { normalizePackForLoad, validateTopicPack } from "./schema";
import { loosePlan, publishChecks, removeScenes } from "./looseScenes";
import { buildSceneTree, subtreeSceneIds } from "./tree";
import { deleteSceneFrom, topicHealth } from "./studioModel";

const spot = (id, extra = {}) => ({ id, label: id, blurb: `${id}!`, x: 30, y: 40, info: { title: id, body: [`About ${id}.`] }, ...extra });
const scene = (id, extra = {}) => ({ id, title: id, narration: `${id} story`, image: { src: `/wikido/${id}.png`, alt: id }, hotspots: [spot(`${id}-a`)], ...extra });

function pack() {
  return {
    id: "earth", title: "Earth", tagline: "Earth", rootSceneId: "asia",
    scenes: {
      asia: scene("asia", { hotspots: [spot("to-india", { childSceneId: "india" })], perspectives: [{ id: "history", sceneId: "asia-history" }, { id: "food", sceneId: "asia-food" }] }),
      india: scene("india"),
      "asia-history": scene("asia-history", { perspectiveOf: "asia", lens: "history", hotspots: [spot("silk", { childSceneId: "silk-road" })] }),
      "asia-food": scene("asia-food", { perspectiveOf: "asia", lens: "food" }),
      "silk-road": scene("silk-road"),
    },
  };
}

describe("child loader with perspectives", () => {
  it("an old single-picture world loads unchanged", () => {
    const old = pack();
    delete old.scenes.asia.perspectives;
    delete old.scenes["asia-history"];
    delete old.scenes["asia-food"];
    delete old.scenes["silk-road"];
    const loaded = normalizePackForLoad(old);
    expect(loaded).toBe(old);
    expect(validateTopicPack(loaded)).toEqual([]);
  });

  it("keeps ready lenses and the scenes they open", () => {
    const loaded = normalizePackForLoad(pack());
    expect(validateTopicPack(loaded)).toEqual([]);
    expect(Object.keys(loaded.scenes).sort()).toEqual(["asia", "asia-food", "asia-history", "india", "silk-road"]);
  });

  it("drops an unpainted lens (and what only it opens) instead of failing the world", () => {
    const p = pack();
    p.scenes["asia-history"].image.src = "";
    const loaded = normalizePackForLoad(p);
    expect(validateTopicPack(loaded)).toEqual([]);
    expect(loaded.scenes.asia.perspectives.map((e) => e.id)).toEqual(["food"]);
    expect(loaded.scenes["asia-history"]).toBeUndefined();
    expect(loaded.scenes["silk-road"]).toBeUndefined();
  });

  it("drops a lens whose back-link is broken", () => {
    const p = pack();
    p.scenes["asia-food"].lens = "map";
    const loaded = normalizePackForLoad(p);
    expect(validateTopicPack(loaded)).toEqual([]);
    expect(loaded.scenes["asia-food"]).toBeUndefined();
  });
});

describe("studio helpers with perspectives", () => {
  it("lens scenes and their children are not loose", () => {
    expect(loosePlan(pack().scenes, "asia").ids).toEqual([]);
  });

  it("removing a lens scene also unlists it", () => {
    const next = removeScenes(pack().scenes, ["asia-food"]);
    expect(next.asia.perspectives.map((e) => e.id)).toEqual(["history"]);
  });

  it("tree hides lens rows, hangs lens children under the base", () => {
    const rows = buildSceneTree(pack().scenes, "asia");
    expect(rows.map((r) => r.id)).toEqual(["asia", "india", "silk-road"]);
    expect(rows.find((r) => r.id === "silk-road").parentId).toBe("asia");
    expect(subtreeSceneIds(pack().scenes, "asia").sort()).toEqual(["asia", "asia-food", "asia-history", "india", "silk-road"]);
  });

  it("deleting a scene takes its perspective pictures with it", () => {
    const p = pack();
    p.scenes.india.perspectives = [{ id: "food", sceneId: "india-food" }];
    p.scenes["india-food"] = scene("india-food", { perspectiveOf: "india", lens: "food" });
    const next = deleteSceneFrom(p.scenes, "india");
    expect(next.india).toBeUndefined();
    expect(next["india-food"]).toBeUndefined();
    expect(next.asia.hotspots[0].childSceneId).toBeUndefined();
  });

  it("health sees lens scenes as reachable; publish checks note unfinished lenses", () => {
    const p = pack();
    expect(topicHealth(p.scenes, "asia").filter((i) => i.text.includes("isn’t opened"))).toEqual([]);
    p.scenes["asia-food"].image.src = "";
    const checks = publishChecks(p);
    expect(checks.blockers).toEqual([]);
    expect(checks.notes.some((n) => n.key === "lenses" && n.text.includes("Food"))).toBe(true);
  });
});
