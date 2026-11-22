import { describe, it, expect, vi } from "vitest";
import { latToTileY, lngToTileX, tileLat, tileLng, tileZoomFor, getTile } from "./tiles";

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
  it("never downloads more than a handful of tiles at once (OSM policy)", () => {
    const started = [];
    vi.stubGlobal("Image", class { set src(v) { started.push(v); } });
    for (let x = 0; x < 20; x += 1) getTile(18, x, 5);
    expect(started.length).toBeLessThanOrEqual(4);
    vi.unstubAllGlobals();
  });
});
