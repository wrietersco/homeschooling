import { describe, it, expect } from "vitest";
import { ancestorIds, childCounts, keyAction, loadCollapsed, parentIds, saveCollapsed, visibleRows } from "./treeView";

// root → uk → london → tower ;  root → fr
const rows = [
  { id: "root", depth: 0, parentId: null },
  { id: "uk", depth: 1, parentId: "root" },
  { id: "london", depth: 2, parentId: "uk" },
  { id: "tower", depth: 3, parentId: "london" },
  { id: "fr", depth: 1, parentId: "root" },
];
const titles = { uk: "United Kingdom", tower: "Inside Tower Bridge" };
const scenes = Object.fromEntries(rows.map((r) => [r.id, { id: r.id, title: titles[r.id] || r.id, hotspots: [] }]));
const statusOf = (id) => (id === "tower" ? "needs-artwork" : id === "fr" ? "broken-link" : "ready");
const ids = (res) => res.rows.map((r) => r.id);

describe("treeView", () => {
  it("counts children", () => {
    const { direct, total } = childCounts(rows);
    expect(direct.get("root")).toBe(2);
    expect(total.get("uk")).toBe(2);
    expect(total.get("fr")).toBe(0);
  });
  it("hides collapsed subtrees", () => {
    expect(ids(visibleRows({ rows, collapsed: new Set(["uk"]), scenes, statusOf }))).toEqual(["root", "uk", "fr"]);
    expect(ids(visibleRows({ rows, collapsed: new Set(["root"]), scenes, statusOf }))).toEqual(["root"]);
  });
  it("search keeps ancestors and ignores collapse", () => {
    const res = visibleRows({ rows, collapsed: new Set(["uk"]), query: "tower", scenes, statusOf });
    expect(ids(res)).toEqual(["root", "uk", "london", "tower"]);
    expect([...res.matchIds]).toEqual(["tower"]);
    expect(res.matchCount).toBe(1);
  });
  it("status filter treats broken links as needs attention", () => {
    const res = visibleRows({ rows, collapsed: new Set(), statuses: new Set(["needs-spots"]), scenes, statusOf });
    expect(ids(res)).toEqual(["root", "fr"]);
  });
  it("lists ancestors and parents", () => {
    expect(ancestorIds(rows, "tower")).toEqual(["london", "uk", "root"]);
    expect(parentIds(rows)).toEqual(["root", "uk", "london"]);
  });
  it("keyboard actions", () => {
    const base = { visible: rows, collapsed: new Set() };
    expect(keyAction({ ...base, key: "ArrowDown", id: "uk", hasChildren: true })).toEqual({ select: "london" });
    expect(keyAction({ ...base, key: "ArrowLeft", id: "uk", hasChildren: true })).toEqual({ collapse: "uk" });
    expect(keyAction({ ...base, key: "ArrowLeft", id: "tower", hasChildren: false })).toEqual({ select: "london" });
    expect(keyAction({ ...base, collapsed: new Set(["uk"]), key: "ArrowRight", id: "uk", hasChildren: true })).toEqual({ expand: "uk" });
    expect(keyAction({ ...base, key: "ArrowRight", id: "uk", hasChildren: true })).toEqual({ select: "london" });
  });
  it("remembers collapsed state and survives broken storage", () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    saveCollapsed("w1", new Set(["a"]), storage);
    expect([...loadCollapsed("w1", storage)]).toEqual(["a"]);
    expect(loadCollapsed("w2", storage).size).toBe(0);
    const bad = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
    expect(loadCollapsed("w1", bad).size).toBe(0);
    expect(() => saveCollapsed("w1", new Set(), bad)).not.toThrow();
  });
});
