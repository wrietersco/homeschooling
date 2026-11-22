import { describe, it, expect } from "vitest";
import { loosePlan, removeAllLoose, attachBranch, attachTargets, publishChecks } from "./looseScenes.js";

const sc = (id, hotspots = []) => ({ id, title: id.toUpperCase(), narration: "n", image: { src: `https://x/${id}.jpg`, alt: id }, hotspots });
const door = (id, child) => ({ id, label: id, blurb: id, x: 50, y: 50, childSceneId: child, info: { title: id, body: ["p"] } });
const fact = (id) => ({ id, label: id, blurb: id, x: 50, y: 50, info: { title: id, body: ["p"] } });
// production shape: a Pakistan branch with children, none of it reachable
const world = () => ({
  id: "w", title: "W", tagline: "t", rootSceneId: "root",
  scenes: {
    root: sc("root", [door("a", "a")]),
    a: sc("a", [fact("f")]),
    pk: sc("pk", [door("k2", "k2"), door("bir", "bir")]),
    k2: sc("k2", [fact("g")]),
    bir: sc("bir", [fact("h")]),
    lone: sc("lone", [fact("i")]),
  },
});

describe("loose scenes", () => {
  it("groups loose scenes into branches headed by the scene nothing loose opens", () => {
    const p = loosePlan(world().scenes, "root");
    expect([...p.ids].sort()).toEqual(["bir", "k2", "lone", "pk"]);
    expect(p.branches.map((b) => [b.id, b.count]).sort()).toEqual([["lone", 1], ["pk", 3]]);
  });
  it("cleans up all loose scenes without touching the reachable ones", () => {
    const next = removeAllLoose(world().scenes, "root");
    expect(Object.keys(next).sort()).toEqual(["a", "root"]);
    expect(loosePlan(next, "root").ids).toEqual([]);
  });
  it("attaches a branch under a picture by adding a spot that opens it", () => {
    const next = attachBranch(world().scenes, "pk", "a");
    expect(next.a.hotspots.some((h) => h.childSceneId === "pk")).toBe(true);
    expect(loosePlan(next, "root").ids).toEqual(["lone"]);
  });
  it("only offers pictures with room as attach targets", () => {
    const w = world();
    w.scenes.a.hotspots = Array.from({ length: 8 }, (_, i) => fact(`s${i}`));
    expect(attachTargets(w.scenes, "root").map((t) => t.id)).toEqual(["root"]);
    expect(attachTargets(w.scenes, "root", { excludeHub: true })).toEqual([]);
  });
  it("publish checks: loose scenes are a note, a would-fail world is a blocker", () => {
    const c = publishChecks(world());
    expect(c.blockers).toEqual([]);
    expect(c.notes.map((n) => n.key)).toContain("loose");
    const bad = world();
    bad.scenes.a.image.src = "";
    expect(publishChecks(bad).blockers.length).toBeGreaterThan(0);
  });
});
