import { describe, expect, it } from "vitest";
import { ringOffset, visiblePanels, panelPose, settleIndex, stepsTo, wrapIndex, panelCaption, VISIBLE } from "./hallLayout";

describe("hall layout", () => {
  it("wraps offsets round the ring", () => {
    expect(ringOffset(0, 0, 5)).toBe(0);
    expect(ringOffset(4, 0, 5)).toBe(-1);
    expect(ringOffset(1, 4, 5)).toBe(2);
    expect(ringOffset(0, 4.5, 5)).toBeCloseTo(0.5);
  });

  it("draws the same handful of panels for 5 or 500 perspectives", () => {
    expect(visiblePanels(0, 5).length).toBe(5);
    const big = visiblePanels(37, 500);
    expect(big.length).toBeLessThanOrEqual(2 * VISIBLE + 2);
    expect(big[0]).toEqual({ i: 37, d: 0 });
    expect(big.every((p) => Math.abs(p.d) <= VISIBLE + 0.5)).toBe(true);
  });

  it("works for 100 perspectives and wraps at the ends", () => {
    const at = visiblePanels(99, 100);
    expect(at.some((p) => p.i === 0 && p.d === 1)).toBe(true);
    expect(at.some((p) => p.i === 93 && p.d === -6)).toBe(true);
  });

  it("puts the focused panel straight ahead and big, far ones faded", () => {
    const front = panelPose(0);
    expect(front.x).toBeCloseTo(0);
    expect(front.z).toBeLessThan(0);
    expect(front.opacity).toBe(1);
    expect(front.scale).toBeGreaterThan(1);
    expect(panelPose(VISIBLE).opacity).toBe(0);
    expect(panelPose(-1).x).toBeLessThan(0);
    expect(panelPose(1).x).toBeGreaterThan(0);
    expect(panelPose(3).scale).toBeLessThan(panelPose(1).scale);
  });

  it("settles a swipe on a panel, with a flick carrying further", () => {
    expect(settleIndex(2.3, 0, 10)).toBe(2);
    expect(settleIndex(2.3, 20, 10)).toBeGreaterThan(2);
    expect(settleIndex(0.2, -30, 10)).toBeLessThan(10);
    expect(settleIndex(-0.2, 0, 10)).toBe(0);
  });

  it("finds the shortest way round to a tapped panel", () => {
    expect(stepsTo(0, 9, 10)).toBe(-1);
    expect(stepsTo(0, 3, 10)).toBe(3);
    expect(wrapIndex(-1, 10)).toBe(9);
  });

  it("captions a panel from its lens", () => {
    const c = panelCaption({ lens: { name: "History", emoji: "📜", color: "#a16207" }, scene: { hotspots: [1, 2, 3] } });
    expect(c).toMatchObject({ title: "History", emoji: "📜", color: "#a16207", spots: 3, sub: "3 things to discover" });
    expect(panelCaption(null).title).toBe("Overview");
  });
});
