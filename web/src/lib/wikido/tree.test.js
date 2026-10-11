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
