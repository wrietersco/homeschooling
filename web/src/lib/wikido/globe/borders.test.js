import { describe, it, expect } from "vitest";
import { COUNTRY_BORDERS } from "./borders.js";
import { countries } from "../../../../../functions/lib/wikidoGazetteer.js";

// The border dataset is GENERATED from Natural Earth 110m (public domain) by
// scripts/generate-globe-borders.mjs. These checks catch a broken or stale
// codegen run before a malformed ring reaches a child's screen.
describe("globe country borders", () => {
  it("covers the world's sovereign land", () => {
    const keyed = Object.keys(COUNTRY_BORDERS).filter((k) => !k.startsWith("_"));
    expect(keyed.length).toBeGreaterThanOrEqual(160);
    // the places the user actually pins first
    for (const id of ["pk", "in", "us", "cn", "br", "eg", "tr", "gb", "za", "jp"]) {
      expect(COUNTRY_BORDERS[id], id).toBeTruthy();
    }
    // non-sovereign land kept for the globe's drawing (Antarctica, Greenland…)
    expect(COUNTRY_BORDERS._other.length).toBeGreaterThan(5);
  });

  it("carries valid coordinates and well-formed polygons", () => {
    for (const [id, polys] of Object.entries(COUNTRY_BORDERS)) {
      expect(polys.length, id).toBeGreaterThan(0);
      for (const rings of polys) {
        expect(rings.length, id).toBeGreaterThan(0);
        for (const ring of rings) {
          expect(ring.length, `${id} ring`).toBeGreaterThanOrEqual(4);
          for (const [lng, lat] of ring) {
            expect(lng).toBeGreaterThanOrEqual(-180);
            expect(lng).toBeLessThanOrEqual(180);
            expect(lat).toBeGreaterThanOrEqual(-90);
            expect(lat).toBeLessThanOrEqual(90);
          }
          // rings are closed (first point repeats at the end)
          expect(ring[0]).toEqual(ring[ring.length - 1]);
        }
      }
    }
  });

  it("covers most of the gazetteer, and the gaps are only tiny nations", () => {
    const keyed = new Set(Object.keys(COUNTRY_BORDERS));
    const missing = countries.filter((c) => !keyed.has(c.id)).map((c) => c.id);
    // everything else than this allowlist of microstates / tiny islands must
    // have outlines — a big country without borders is a codegen regression
    const tiny = new Set(["ad", "cv", "st", "mc", "sm", "va", "li", "mt", "sg", "bh", "mv", "bb", "sc", "km", "mu", "tv", "nr", "pw", "mh", "ki", "to", "ws", "fm"]);
    expect(missing.filter((id) => !tiny.has(id))).toEqual([]);
  });
});
