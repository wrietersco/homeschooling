import { describe, it, expect } from "vitest";
import { withKeys, countOutline, removeOutlineNode, flattenOutline, runOutline, summarizeRun } from "./outlineBuild";

const tree = () =>
  withKeys([
    { label: "A", focus: "fa", children: [{ label: "A1", focus: "f", children: [] }, { label: "A2", focus: "f", children: [] }] },
    { label: "B", focus: "fb", children: [{ label: "B1", focus: "f", children: [] }] },
  ]);

describe("outline helpers", () => {
  it("counts, flattens breadth-first with parents, and removes whole subtrees", () => {
    const t = tree();
    expect(countOutline(t)).toBe(5);
    expect(flattenOutline(t).map((i) => i.label)).toEqual(["A", "B", "A1", "A2", "B1"]);
    expect(flattenOutline(t).find((i) => i.label === "A1").parentKey).toBe(t[0].key);
    const pruned = removeOutlineNode(t, t[0].key);
    expect(countOutline(pruned)).toBe(2);
    expect(t).toHaveLength(2); // original untouched
  });
});

describe("runOutline", () => {
  it("creates scenes under the right parents, in order", async () => {
    const calls = [];
    const createScene = async (a) => {
      calls.push(a);
      return { sceneId: `scene-${a.label.toLowerCase()}` };
    };
    const { items, created } = await runOutline({ outline: tree(), parentSceneId: "root", createScene });
    expect(created).toEqual(["scene-a", "scene-b", "scene-a1", "scene-a2", "scene-b1"]);
    expect(calls.find((c) => c.label === "A1").parentSceneId).toBe("scene-a");
    expect(calls.find((c) => c.label === "A").parentSceneId).toBe("root");
    expect(summarizeRun(items)).toEqual({ done: 5, failed: 0, skipped: 0, pending: 0 });
  });

  it("a failed scene skips only its own subtree; siblings carry on", async () => {
    const createScene = async (a) => {
      if (a.label === "A") throw new Error("internal: The generated scene was incomplete");
      return { sceneId: `scene-${a.label.toLowerCase()}` };
    };
    const { items, created } = await runOutline({ outline: tree(), parentSceneId: "root", createScene });
    const status = Object.fromEntries(items.map((i) => [i.label, i.status]));
    expect(status).toEqual({ A: "failed", B: "done", A1: "skipped", A2: "skipped", B1: "done" });
    expect(items.find((i) => i.label === "A").error).toBe("The generated scene was incomplete");
    expect(created).toEqual(["scene-b", "scene-b1"]);
  });

  it("can be stopped between scenes and reports live progress", async () => {
    let n = 0;
    const updates = [];
    const { items, stopped, created } = await runOutline({
      outline: tree(),
      parentSceneId: "root",
      createScene: async (a) => { n += 1; return { sceneId: `s${n}` }; },
      shouldStop: () => n >= 2,
      onUpdate: (snap) => updates.push(snap.map((i) => i.status).join(",")),
    });
    expect(stopped).toBe(true);
    expect(created).toHaveLength(2);
    expect(summarizeRun(items)).toEqual({ done: 2, failed: 0, skipped: 0, pending: 3 });
    expect(updates[0]).toBe("pending,pending,pending,pending,pending");
    expect(updates.some((u) => u.startsWith("running"))).toBe(true);
  });
});
