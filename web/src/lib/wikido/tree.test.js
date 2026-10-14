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
  it("keeps each parent's descendants together with depth and parents", () => {
    const tree = buildSceneTree(scenes, "root");
    expect(tree.map((t) => t.id)).toEqual(["root", "clouds", "rain", "snow", "ocean", "tides", "lost"]);
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

import { subtreeSceneIds, canMoveScene, moveSceneTo, moveSceneByDrop, resolveDrop, buildSceneTree as buildTree, ancestorChain } from "./tree.js";

describe("cross-topic doorways in the tree", () => {
  // a spot with childTopicId opens a scene in ANOTHER pack — its childSceneId
  // belongs to that pack's namespace and must be invisible to local walks
  const withWorldDoor = {
    ...scenes,
    clouds: {
      ...scenes.clouds,
      hotspots: [
        ...scenes.clouds.hotspots,
        { id: "d-world", label: "Another World", childTopicId: "astronomy", childSceneId: "clouds" }, // slug collides on purpose
      ],
    },
  };

  it("ignores cross-topic doorways when walking the local tree", () => {
    expect(buildSceneTree(withWorldDoor, "root").map((t) => t.id)).toEqual(["root", "clouds", "rain", "snow", "ocean", "tides", "lost"]);
    expect(findParentSceneId(withWorldDoor, "clouds")).toBe("root");
    expect(subtreeSceneIds(withWorldDoor, "root")).toEqual(["root", "clouds", "rain", "snow", "ocean", "tides"]);
    // moving "rain" around never treats the world door as a second edge
    expect(canMoveScene(withWorldDoor, "clouds", "root", "root")).toBe(true);
  });

  it("does not strip or re-parent cross-topic doorways when moving scenes", () => {
    const next = moveSceneTo(withWorldDoor, "rain", "ocean", null, "root");
    expect(next).not.toBeNull();
    const worldDoor = next.clouds.hotspots.find((h) => h.id === "d-world");
    expect(worldDoor.childTopicId).toBe("astronomy");
    expect(worldDoor.childSceneId).toBe("clouds");
  });
});

describe("ancestorChain", () => {
  it("lists the ancestors of a deep scene, root first", () => {
    expect(ancestorChain(scenes, "rain")).toEqual(["root", "clouds"]);
    expect(ancestorChain(scenes, "snow")).toEqual(["root", "clouds"]);
    expect(ancestorChain(scenes, "tides")).toEqual(["root", "ocean"]);
  });

  it("is empty for the root and orphans", () => {
    expect(ancestorChain(scenes, "root")).toEqual([]);
    expect(ancestorChain(scenes, "lost")).toEqual([]);
    expect(ancestorChain(scenes, "nope")).toEqual([]);
  });
});

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

  it("re-parenting takes the whole branch along, not just the scene", () => {
    const next = moveSceneTo(zoo, "animals", "plants", null, "root");
    const tree = buildTree(next, "root");
    expect(tree.find((t) => t.id === "cats").parentId).toBe("animals");     // branch still attached…
    expect(tree.find((t) => t.id === "kittens").parentId).toBe("cats");     // …all the way down
    expect(tree.find((t) => t.id === "animals").parentId).toBe("plants");   // new parent in force
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

describe("re-parenting rules (one parent per scene)", () => {
  // root → [a, b, c] in doorway order
  const wide = {
    root: { id: "root", title: "Root", hotspots: [
      { id: "d-a", childSceneId: "a" },
      { id: "d-b", childSceneId: "b" },
      { id: "d-c", childSceneId: "c" },
    ] },
    a: { id: "a", title: "A", hotspots: [] },
    b: { id: "b", title: "B", hotspots: [] },
    c: { id: "c", title: "C", hotspots: [] },
  };

  it("a forward drop between rows lands exactly in the indicated slot", () => {
    const next = moveSceneByDrop(wide, "a", "b", "after", "root");
    expect(next.root.hotspots.map((h) => h.childSceneId)).toEqual(["b", "a", "c"]);
    const back = moveSceneByDrop(next, "a", "b", "before", "root");
    expect(back.root.hotspots.map((h) => h.childSceneId)).toEqual(["a", "b", "c"]);
  });

  it("reordering inside a full picture still works (a reorder adds no spot)", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `d-${i}`, childSceneId: `s${i}` }));
    const scenes = {
      full: { id: "full", title: "Full", hotspots: eight },
      ...Object.fromEntries(eight.map((h) => [h.childSceneId, { id: h.childSceneId, title: h.childSceneId, hotspots: [] }])),
    };
    expect(canMoveScene(scenes, "s0", "full")).toBe(true); // already hangs there
    const next = moveSceneByDrop(scenes, "s0", "s1", "after");
    expect(next.full.hotspots.map((h) => h.childSceneId).slice(0, 3)).toEqual(["s1", "s0", "s2"]);
  });

  it("the entrance never moves, by drag or by drop", () => {
    expect(canMoveScene(wide, "root", "a", "root")).toBe(false);
    expect(moveSceneTo(wide, "root", "a", null, "root")).toBeNull();
    expect(moveSceneByDrop(wide, "root", "a", "into", "root")).toBeNull();
  });

  it("a gap next to a parentless row nests under it instead of doing nothing", () => {
    const withOrphan = { ...wide, lost: { id: "lost", title: "Lost", hotspots: [] } };
    const plan = resolveDrop(withOrphan, "a", "lost", "after", "root");
    expect(plan).toEqual({ parentId: "lost", insertIndex: null, mode: "into" });
    const next = moveSceneByDrop(withOrphan, "a", "lost", "after", "root");
    expect(next.lost.hotspots.map((h) => h.childSceneId)).toEqual(["a"]);
  });

  it("moving a scene with two doorways keeps one parent: the other spot becomes a fact card", () => {
    const scenes = {
      root: { id: "root", title: "Root", hotspots: [
        { id: "d-x", childSceneId: "x" },
        { id: "d-kid", label: "Kid", childSceneId: "kid" },
      ] },
      x: { id: "x", title: "X", hotspots: [] },
      kid: { id: "kid", title: "Kid", hotspots: [] },
      twin: { id: "twin", title: "Twin", hotspots: [{ id: "d-kid2", label: "Kid again", childSceneId: "kid" }] },
    };
    const next = moveSceneTo(scenes, "kid", "x", null, "root");
    expect(next.x.hotspots.map((h) => h.childSceneId)).toEqual(["kid"]);   // the travelling doorway arrived
    expect(next.root.hotspots.some((h) => h.childSceneId === "kid")).toBe(false);
    expect(next.twin.hotspots[0].label).toBe("Kid again");                 // duplicate kept as a spot…
    expect(next.twin.hotspots[0].childSceneId).toBeUndefined();            // …but no longer a doorway
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
