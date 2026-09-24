import { describe, it, expect } from "vitest";
import { MODE_LABELS, whenLabel, highlightPairs } from "./exploreHistory";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

describe("explore history", () => {
  it("names the modes a parent sees", () => {
    expect(MODE_LABELS.explore).toBe("Exploration");
    expect(MODE_LABELS.learn).toBe("Learning");
  });

  it("says when, the way a parent thinks about it", () => {
    expect(whenLabel(daysAgo(0), NOW)).toBe("Today");
    expect(whenLabel(daysAgo(1), NOW)).toBe("Yesterday");
    expect(whenLabel(daysAgo(3), NOW)).toBe("3 days ago");
    expect(whenLabel(daysAgo(30), NOW)).toMatch(/\d/);
    expect(whenLabel(null, NOW)).toBe("");
  });

  it("renders whatever shape the buddy filed", () => {
    // A speech lesson (the real shape from a live run).
    expect(highlightPairs({ topic: "the k sound at the start of words", attempts: 3, outcome: "mastered" })).toEqual([
      { key: "topic", value: "the k sound at the start of words" },
      { key: "attempts", value: "3" },
      { key: "outcome", value: "mastered" },
    ]);
    // A maths one, with different keys entirely.
    expect(highlightPairs({ concept: "sharing 10 sweets", tries_to_understand: 2, mastered: false })).toEqual([
      { key: "concept", value: "sharing 10 sweets" },
      { key: "tries to understand", value: "2" },
      { key: "mastered", value: "no" },
    ]);
    // Lists and one level of nesting stay readable.
    expect(highlightPairs({ words: ["cat", "kite"] })[0].value).toBe("cat, kite");
    expect(highlightPairs({ words: { cat: "correct", kite: "3 tries" } })[0].value).toBe("cat: correct, kite: 3 tries");
    // Empty values are not worth a chip.
    expect(highlightPairs({ topic: "x", struggled_with: "", note: null })).toHaveLength(1);
    expect(highlightPairs({})).toEqual([]);
  });
});
