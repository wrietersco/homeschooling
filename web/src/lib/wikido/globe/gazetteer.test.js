import { describe, it, expect } from "vitest";
import {
  countries, cities, resolvePlaceQuery, slugName, SPOT_LEVELS, isLatLng, isLng,
} from "../../../../../functions/lib/wikidoGazetteer.js";

// The gazetteer is the globe's database — the superadmin's typed place names
// resolve against it before the language model is ever asked.
describe("wikido gazetteer", () => {
  it("stores the world's countries with their capitals", () => {
    expect(countries.length).toBeGreaterThanOrEqual(190);
    for (const c of countries) {
      expect(c.id).toMatch(/^[a-z]{2}$/);
      expect(isLatLng(c.lat), c.id).toBe(true);
      expect(isLng(c.lng), c.id).toBe(true);
      expect(c.capital).toBeTruthy();
      expect(isLatLng(c.capLat), c.id).toBe(true);
      expect(isLng(c.capLng), c.id).toBe(true);
      expect(c.region).toBeTruthy();
    }
  });

  it("stores major cities inside real countries with valid coordinates", () => {
    expect(cities.length).toBeGreaterThanOrEqual(400);
    const ids = new Set(countries.map((c) => c.id));
    const cityIds = new Set();
    for (const city of cities) {
      expect(ids.has(city.country), city.id).toBe(true);
      expect(isLatLng(city.lat), city.id).toBe(true);
      expect(isLng(city.lng), city.id).toBe(true);
      expect(cityIds.has(city.id), `duplicate city id ${city.id}`).toBe(false);
      cityIds.add(city.id);
    }
  });

  it("resolves countries, capitals and cities — the superadmin's examples", () => {
    const pakistan = resolvePlaceQuery("pakistan");
    expect(pakistan).toMatchObject({ kind: "country", level: "country", id: "pk", name: "Pakistan" });
    expect(pakistan.lat).toBeCloseTo(30.4, 1);
    expect(pakistan.country.id).toBe("pk");

    expect(resolvePlaceQuery("Lahore")).toMatchObject({ kind: "city", level: "city", name: "Lahore", country: { id: "pk" } });
    expect(resolvePlaceQuery("Islamabad")).toMatchObject({ kind: "city", capital: true, name: "Islamabad" });
  });

  it("resolves aliases people actually type", () => {
    expect(resolvePlaceQuery("USA")?.id).toBe("us");
    expect(resolvePlaceQuery("America")?.id).toBe("us");
    expect(resolvePlaceQuery("uk")?.id).toBe("gb");
    expect(resolvePlaceQuery("U.A.E.")?.id).toBe("ae");
    expect(resolvePlaceQuery("Türkiye")?.id).toBe("tr");
    expect(resolvePlaceQuery("the Netherlands")?.id).toBe("nl");
  });

  it("is case, accent and punctuation tolerant", () => {
    expect(resolvePlaceQuery("  PAKISTAN ")?.id).toBe("pk");
    expect(resolvePlaceQuery("São Paulo")?.country).toMatchObject({ id: "br" });
    expect(resolvePlaceQuery("Nuku'alofa")).toMatchObject({ kind: "city", name: "Nuku'alofa" });
  });

  it("returns null for non-places (the caller falls back to the model)", () => {
    expect(resolvePlaceQuery("Eiffel Tower")).toBeNull();
    expect(resolvePlaceQuery("")).toBeNull();
    expect(resolvePlaceQuery("xyzzy")).toBeNull();
  });

  it("never guesses on ambiguous prefixes", () => {
    // "guinea" matches exactly one country, but "new" could be many places
    expect(resolvePlaceQuery("guinea")).toMatchObject({ id: "gn" });
    expect(resolvePlaceQuery("new")).toBeNull();
  });

  it("slugifies display names for spot ids", () => {
    expect(slugName("Badshahi Mosque")).toBe("badshahi-mosque");
    expect(slugName("Nuku'alofa")).toBe("nukualofa");
    expect(SPOT_LEVELS).toEqual(["country", "city", "location"]);
  });
});
