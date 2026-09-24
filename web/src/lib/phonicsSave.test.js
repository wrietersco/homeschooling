import { describe, it, expect } from "vitest";

import { loadCanvas, restoreCanvas, saveCanvas, saveKey, serializeCanvas } from "./phonicsSave";

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    raw: m,
  };
}

const STATE = {
  groups: [
    { key: 3, x: 120, y: 80, soundIds: ["c", "a", "t", "space", "s"] },
    { key: 7, x: -40, y: 300, soundIds: ["qu"] },
  ],
  wordsBuilt: 2,
  pan: { x: 15, y: -30 },
  activeRowKey: 3,
};

describe("phonicsSave", () => {
  it("round-trips the canvas through storage", () => {
    const s = memStorage();
    saveCanvas("kid1", STATE, s);
    const out = loadCanvas("kid1", s);
    expect(out.groups).toEqual(STATE.groups);
    expect(out.wordsBuilt).toBe(2);
    expect(out.pan).toEqual({ x: 15, y: -30 });
    expect(out.activeRowKey).toBe(3);
    // New rows must get keys above every restored key.
    expect(out.groupSeq).toBe(7);
  });

  it("keeps each child's canvas separate", () => {
    const s = memStorage();
    saveCanvas("kid1", STATE, s);
    expect(loadCanvas("kid2", s)).toBeNull();
    expect(saveKey("kid1")).not.toBe(saveKey("kid2"));
  });

  it("does not share or alias the live row arrays", () => {
    const snap = serializeCanvas(STATE);
    snap.groups[0].soundIds.push("x");
    expect(STATE.groups[0].soundIds).toHaveLength(5);
  });

  it("returns null for missing, corrupt or foreign data", () => {
    const s = memStorage();
    expect(loadCanvas("kid1", s)).toBeNull();
    s.setItem(saveKey("kid1"), "{not json");
    expect(loadCanvas("kid1", s)).toBeNull();
    expect(restoreCanvas({ v: 99, groups: [] })).toBeNull();
    expect(restoreCanvas(null)).toBeNull();
  });

  it("drops unusable rows and unknown sounds instead of crashing", () => {
    const out = restoreCanvas({
      v: 1,
      groups: [
        { key: 1, x: 0, y: 0, soundIds: ["b", "zzz", "toString"] },
        { key: 2, x: "nope", y: 0, soundIds: ["a"] },
        { key: 3, x: 0, y: 0, soundIds: ["nope"] },
        { key: 1, x: 5, y: 5, soundIds: ["d"] }, // duplicate key
        null,
      ],
      wordsBuilt: -4,
      pan: { x: "bad" },
      activeRowKey: 2,
    });
    expect(out.groups).toEqual([{ key: 1, x: 0, y: 0, soundIds: ["b"] }]);
    expect(out.wordsBuilt).toBe(0);
    expect(out.pan).toEqual({ x: 0, y: 0 });
    expect(out.activeRowKey).toBeNull(); // pointed at a dropped row
    expect(out.groupSeq).toBe(1);
  });

  it("an empty (cleared) canvas restores as empty", () => {
    const s = memStorage();
    saveCanvas("kid1", { groups: [], wordsBuilt: 3, pan: { x: 0, y: 0 }, activeRowKey: null }, s);
    const out = loadCanvas("kid1", s);
    expect(out.groups).toEqual([]);
    expect(out.wordsBuilt).toBe(3);
  });

  it("survives storage that throws (private mode)", () => {
    const bad = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(() => saveCanvas("kid1", STATE, bad)).not.toThrow();
    expect(loadCanvas("kid1", bad)).toBeNull();
  });
});
