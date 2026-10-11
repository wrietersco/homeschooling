import { describe, it, expect } from "vitest";
import { buildSceneTree, findParentSceneId, siblingSceneIds, moveSceneSibling } from "./tree.js";

// root → (clouds → [rain, snow]), (ocean → [tides]); orphan: lost
const scenes = {
  root: { id: "root", title: "Root", hotspots: [
    { id: "d-clouds", childSceneId: "clouds" },
    { id: "d-ocean", childSceneId: "ocean" },
  ] },
  clouds: { id: "clouds", title: "Clouds", hotspots: [
    { id: "d-rain", childSceneId: "rain" },
    { id: "d-snow", childSceneId: "snow" },
  ] },
  rain: { id: "rain", title: "Rain", hotspots: [] },
  snow: { id: "snow", title: "Snow", hotspots: [] },
  ocean: { id: "ocean", title: "Ocean", hotspots: [
    { id: "d-tides", childSceneId: "tides" },
  ] },
  tides: { id: "tides", title: "Tides", hotspots: [] },
  lost: { id: "lost", title: "Lost", hotspots: [] },
};

describe("buildSceneTree", () => {
  it("orders scenes breadth-first along doorways with depth and parents", () => {
    const tree = buildSceneTree(scenes, "root");
    expect(tree.map((t) => t.id)).toEqual(["root", "clouds", "ocean", "rain", "snow", "tides", "lost"]);
    expect(tree.find((t) => t.id === "clouds").depth).toBe(1);
    expect(tree.find((t) => t.id === "clouds").parentId).toBe("root");
    expect(tree.find((t) => t.id === "rain").parentId).toBe("clouds");
    expect(tree.find((t) => t.id === "root").parentId).toBeNull();
    expect(tree.find((t) => t.id === "lost").parentId).toBeNull();
  });

  it("survives a missing root", () => {
    expect(buildSceneTree(scenes, "nope").map((t) => t.id)).toEqual(Object.keys(scenes));
  });
});

describe("siblings", () => {
  it("finds the parent and sibling order", () => {
    expect(findParentSceneId(scenes, "rain")).toBe("clouds");
    expect(siblingSceneIds(scenes, "rain")).toEqual(["rain", "snow"]);
    expect(findParentSceneId(scenes, "root")).toBeNull();
    expect(siblingSceneIds(scenes, "lost")).toEqual([]);
  });

  it("reorders siblings by swapping doorways in the parent (immutably)", () => {
    const next = moveSceneSibling(scenes, "snow", "up");
    expect(next).not.toBe(scenes);
    expect(siblingSceneIds(next, "rain")).toEqual(["snow", "rain"]);
    // original untouched
    expect(siblingSceneIds(scenes, "rain")).toEqual(["rain", "snow"]);
  });

  it("returns null at the edges", () => {
    expect(moveSceneSibling(scenes, "rain", "up")).toBeNull();
    expect(moveSceneSibling(scenes, "snow", "down")).toBeNull();
    expect(moveSceneSibling(scenes, "root", "up")).toBeNull(); // no parent
  });
});

import { subtreeSceneIds, canMoveScene, moveSceneTo, moveSceneByDrop } from "./tree.js";

describe("free drag-and-drop (moveSceneTo)", () => {
  const zoo = {
    root: { id: "root", title: "Root", hotspots: [
      { id: "d-a", label: "Animals", childSceneId: "animals" },
      { id: "d-p", label: "Plants", childSceneId: "plants" },
    ] },
    animals: { id: "animals", title: "Animals", hotspots: [
      { id: "d-cats", label: "Cats", childSceneId: "cats" },
      { id: "d-birds", label: "Birds", childSceneId: "birds" },
    ] },
    cats: { id: "cats", title: "Cats", hotspots: [
      { id: "d-kitten", label: "Kittens", childSceneId: "kittens" },
    ] },
    birds: { id: "birds", title: "Birds", hotspots: [] },
    plants: { id: "plants", title: "Plants", hotspots: [] },
    kittens: { id: "kittens", title: "Kittens", hotspots: [] },
    lost: { id: "lost", title: "Lost", hotspots: [] },
  };

  it("guards: root, self, own subtree, missing targets, crowded parents", () => {
    expect(canMoveScene(zoo, "root", "cats")).toBe(false);           // root can't move
    expect(canMoveScene(zoo, "cats", "cats")).toBe(false);           // onto itself
    expect(canMoveScene(zoo, "animals", "kittens")).toBe(false);     // into own subtree (cycle)
    expect(canMoveScene(zoo, "cats", "nowhere")).toBe(false);        // missing target
    const crowded = { ...zoo, root: { ...zoo.root, hotspots: zoo.root.hotspots.concat(Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, childSceneId: null }))) } };
    expect(canMoveScene(crowded, "cats", "root")).toBe(false);       // 8 spots already
  });

  it("re-parents a scene and carries its doorway onto the new parent", () => {
    const next = moveSceneTo(zoo, "birds", "plants");
    expect(next).not.toBe(zoo);
    // doorway left the old parent
    expect(zoo.animals.hotspots.some((h) => h.childSceneId === "birds")).toBe(true); // original untouched
    expect(next.animals.hotspots.some((h) => h.childSceneId === "birds")).toBe(false);
    expect(next.plants.hotspots.some((h) => h.childSceneId === "birds")).toBe(true);
    // subtree travels with the moved scene
    expect(next.birds).toEqual(zoo.birds);
  });

  it("inserts at the requested index, adjusting for the removal shift", () => {
    // move "birds" to before "cats" in the same parent: remove idx0, insert at 0
    const next = moveSceneTo(zoo, "birds", "birds" && "animals", 0).next ?? moveSceneTo(zoo, "birds", "animals", 0);
    expect(next.animals.hotspots.map((h) => h.childSceneId)).toEqual(["birds", "cats"]);
  });

  it("adopts orphan scenes and gives the doorway a usable label", () => {
    const next = moveSceneTo(zoo, "lost", "plants");
    expect(next.plants.hotspots.some((h) => h.childSceneId === "lost")).toBe(true);
    expect(next.plants.hotspots.find((h) => h.childSceneId === "lost").label).toBe("Lost");
  });

  it("returns null for disallowed moves", () => {
    expect(moveSceneTo(zoo, "animals", "kittens")).toBeNull();
  });
});

test("moveSceneByDrop resolves row drops: reorder, nest, and rejects no-ops", () => {
  const scenes = {
    root: { id: "root", title: "Root", hotspots: [
      { id: "d-a", childSceneId: "alpha" },
      { id: "d-b", childSceneId: "beta" },
    ] },
    alpha: { id: "alpha", title: "Alpha", hotspots: [{ id: "d-c", childSceneId: "child-c" }] },
    "child-c": { id: "child-c", title: "Child C", hotspots: [] },
    beta: { id: "beta", title: "Beta", hotspots: [] },
  };
  // drop "beta" BEFORE "alpha" → becomes the first child of root
  const reordered = moveSceneByDrop(scenes, "beta", "alpha", "before");
  expect(reordered.root.hotspots.map((h) => h.childSceneId)).toEqual(["beta", "alpha"]);
  // drop "beta" ONTO "child-c" → nested under it
  const nested = moveSceneByDrop(scenes, "beta", "child-c", "into");
  expect(nested.scenes === undefined).toBe(true); // scenes map keyed, beta re-parented
  expect(nested["child-c"].hotspots.some((h) => h.childSceneId === "beta")).toBe(true);
  // dropping a scene onto itself is a no-op
  expect(moveSceneByDrop(scenes, "alpha", "alpha", "into")).toBeNull();
});
