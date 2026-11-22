import { describe, it, expect } from "vitest";
import { latToTileY, lngToTileX, tileLat, tileLng, tileZoomFor } from "./tiles";

describe("map tiles", () => {
  it("round-trips lat/lng through tile coordinates", () => {
    const z = 17;
    const x = lngToTileX(-0.0754, z);
    const y = latToTileY(51.5055, z);
    expect(tileLng(x, z)).toBeCloseTo(-0.0754, 6);
    expect(tileLat(y, z)).toBeCloseTo(51.5055, 6);
  });
  it("chooses finer tiles as pixels-per-degree grows", () => {
    expect(tileZoomFor(10)).toBeLessThan(tileZoomFor(1e5));
    expect(tileZoomFor(1e12)).toBe(19);
  });
});
