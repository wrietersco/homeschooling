import { describe, it, expect } from "vitest";
import { coverMap } from "./cover.js";

describe("coverMap", () => {
  it("maps percentages 1:1 when container and image share the aspect ratio", () => {
    const a = coverMap(0, 0, 1600, 900, 1600, 900);
    expect(a).toEqual({ left: 0, top: 0 });
    const b = coverMap(100, 100, 1600, 900, 1600, 900);
    expect(b.left).toBeCloseTo(1600);
    expect(b.top).toBeCloseTo(900);
    const c = coverMap(50, 50, 1600, 900, 1600, 900);
    expect(c.left).toBeCloseTo(800);
    expect(c.top).toBeCloseTo(450);
  });

  it("crops only vertically when the container is wider than the image", () => {
    // 2000×900 container, 1600×900 image → scale 1.25, shown 2000×1125,
    // vertical offset −112.5, horizontal fully shown.
    const p = coverMap(50, 50, 2000, 900, 1600, 900);
    expect(p.left).toBeCloseTo(1000); // x spans the full width
    expect(p.top).toBeCloseTo(450);   // picture centre → container centre
    const top = coverMap(0, 0, 2000, 900, 1600, 900);
    expect(top.top).toBeCloseTo(-112.5); // top of the image is cropped
  });

  it("crops only horizontally when the container is taller than the image", () => {
    // 900×1600 container, 1600×900 image → scale 1.7778, shown 2844.4×1600,
    // horizontal offset (900−2844.4)/2 ≈ −972.2.
    const p = coverMap(50, 50, 900, 1600, 1600, 900);
    expect(p.left).toBeCloseTo(1422.2 - 972.2);
    expect(p.top).toBeCloseTo(800);
    const left = coverMap(0, 50, 900, 1600, 1600, 900);
    expect(left.left).toBeCloseTo(-972.2, 1);
  });

  it("defaults to 16:9 artwork when natural dimensions are unknown", () => {
    // unknown dimensions behave exactly like a 1920×1080 image
    const a = coverMap(25, 75, 1600, 900, 0, 0);
    const b = coverMap(25, 75, 1600, 900, 1920, 1080);
    expect(a).toEqual(b);
  });
});
