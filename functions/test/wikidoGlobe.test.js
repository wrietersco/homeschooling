// Wikido globe worlds — pure-function tests (no network, no Admin SDK):
// the gazetteer resolver, the globe pack shape rules, and the agent helpers
// that turn "superadmin says pakistan" into a scene plus a pinned spot.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countries,
  cities,
  resolvePlaceQuery,
  slugName,
  SPOT_LEVELS,
  isLatLng,
  isLng,
} from "../lib/wikidoGazetteer.js";
import {
  normalizeGeneratedPack,
  normalizeForSave,
  validateTopicPack,
  normalizeGlobeTopic,
  normalizePlaceResolution,
  buildGlobeHubSpot,
  buildGlobeScenePrompt,
  buildPlaceResolutionPrompt,
} from "../lib/wikidoPack.js";
import { isGlobePack, isGlobeHub, globeSpots } from "../lib/wikidoGlobe.js";

const hubSpot = (over = {}) => ({
  id: "pakistan",
  label: "Pakistan",
  blurb: "Mountains and the Indus",
  lat: 30.4,
  lng: 69.3,
  level: "country",
  countryId: "pk",
  childSceneId: "pakistan",
  info: { title: "Pakistan", body: ["A country in South Asia."] },
  ...over,
});

const globePack = (over = {}) => ({
  id: "test-atlas",
  title: "Test Atlas",
  tagline: "Test",
  view: "globe",
  rootSceneId: "globe",
  scenes: {
    globe: {
      id: "globe",
      title: "Test Atlas",
      narration: "Spin the globe!",
      image: { src: "", alt: "globe" },
      hotspots: [hubSpot()],
    },
    pakistan: {
      id: "pakistan",
      title: "Pakistan",
      narration: "Land of the Indus.",
      image: { src: "/wikido/test-atlas/pakistan.svg", alt: "p" },
      hotspots: [
        { id: "k2", label: "K2", blurb: "A giant mountain", x: 50, y: 40, info: { title: "K2", body: ["Second highest."] } },
      ],
    },
  },
  ...over,
});

// ── gazetteer ─────────────────────────────────────────────────────────────────
test("gazetteer stores the world with valid coordinates", () => {
  assert.ok(countries.length >= 190);
  for (const c of countries) {
    assert.match(c.id, /^[a-z]{2}$/);
    assert.ok(isLatLng(c.lat), c.id);
    assert.ok(isLng(c.lng), c.id);
    assert.ok(c.capital);
    assert.ok(isLatLng(c.capLat), c.id);
  }
  assert.ok(cities.length >= 400);
  const ids = new Set(countries.map((c) => c.id));
  const seen = new Set();
  for (const city of cities) {
    assert.ok(ids.has(city.country), city.id);
    assert.ok(!seen.has(city.id), `duplicate city id ${city.id}`);
    seen.add(city.id);
  }
});

test("resolves the superadmin's examples: countries, capitals and cities", () => {
  assert.deepEqual(
    { ...resolvePlaceQuery("pakistan"), lat: undefined },
    { ...resolvePlaceQuery("Pakistan"), lat: undefined }
  );
  const pk = resolvePlaceQuery("Pakistan");
  assert.equal(pk.kind, "country");
  assert.equal(pk.level, "country");
  assert.equal(pk.id, "pk");
  assert.equal(pk.country.id, "pk");
  assert.equal(resolvePlaceQuery("lahore").name, "Lahore");
  assert.equal(resolvePlaceQuery("lahore").country.id, "pk");
  assert.equal(resolvePlaceQuery("Islamabad").capital, true);
  assert.equal(resolvePlaceQuery("New York").capital, false);
});

test("resolves aliases and tolerates case, accents and articles", () => {
  assert.equal(resolvePlaceQuery("USA").id, "us");
  assert.equal(resolvePlaceQuery("america").id, "us");
  assert.equal(resolvePlaceQuery("uk").id, "gb");
  assert.equal(resolvePlaceQuery("Türkiye").id, "tr");
  assert.equal(resolvePlaceQuery("the Netherlands").id, "nl");
  assert.equal(resolvePlaceQuery("Nuku'alofa").name, "Nuku'alofa");
  assert.equal(slugName("Badshahi Mosque"), "badshahi-mosque");
  assert.deepEqual(SPOT_LEVELS, ["country", "city", "location"]);
});

test("returns null for non-places and never guesses ambiguous prefixes", () => {
  assert.equal(resolvePlaceQuery("Eiffel Tower"), null);
  assert.equal(resolvePlaceQuery(""), null);
  assert.equal(resolvePlaceQuery("guinea").id, "gn");
  assert.equal(resolvePlaceQuery("new"), null);
});

// ── pack shape ────────────────────────────────────────────────────────────────
test("a globe pack validates with hub relaxations", () => {
  assert.deepEqual(validateTopicPack(globePack(), { allowMissingArtwork: true }), []);
  // the hub never needs artwork — even at the strict publish gate
  assert.deepEqual(validateTopicPack(globePack()), []);
  assert.equal(isGlobePack(globePack()), true);
  assert.equal(isGlobeHub(globePack(), "globe"), true);
  assert.equal(globeSpots(globePack()).length, 1);
});

test("a fresh globe world may be empty", () => {
  const fresh = {
    id: "fresh",
    title: "Fresh",
    tagline: "Fresh",
    view: "globe",
    rootSceneId: "globe",
    scenes: { globe: { id: "globe", title: "Fresh", narration: "Hi", image: { src: "", alt: "g" }, hotspots: [] } },
  };
  assert.deepEqual(validateTopicPack(fresh), []);
});

test("globe hub spots must be doorways pinned with coordinates and a level", () => {
  const missingScene = globePack();
  delete missingScene.scenes.globe.hotspots[0].childSceneId;
  assert.ok(validateTopicPack(missingScene).some((e) => e.includes("must open a scene")));

  const missingCoords = globePack();
  delete missingCoords.scenes.globe.hotspots[0].lat;
  assert.ok(validateTopicPack(missingCoords).some((e) => e.includes("needs lat/lng")));

  const missingLevel = globePack();
  delete missingLevel.scenes.globe.hotspots[0].level;
  assert.ok(validateTopicPack(missingLevel).some((e) => e.includes("needs a level")));
});

test("geo fields are range-checked on every spot, hub or not", () => {
  const badLat = globePack();
  badLat.scenes.pakistan.hotspots[0].lat = 999;
  assert.ok(validateTopicPack(badLat).some((e) => e.includes("lat/lng must be numbers")));

  const badLevel = globePack();
  badLevel.scenes.pakistan.hotspots[0].level = "galaxy";
  assert.ok(validateTopicPack(badLevel).some((e) => e.includes("level must be one of")));

  const badView = globePack({ view: "hologram" });
  assert.ok(validateTopicPack(badView).some((e) => e.includes('view must be "globe"')));
});

test("picture worlds keep requiring x/y percentages and at least one spot", () => {
  const pack = globePack({ view: undefined });
  pack.scenes.globe.hotspots = [{ id: "a", label: "A", blurb: "b", info: { title: "T", body: ["p"] } }];
  const errors = validateTopicPack(pack, { allowMissingArtwork: true });
  assert.ok(errors.some((e) => e.includes("x/y must be percentages")));
  assert.ok(errors.some((e) => e.includes("needs lat/lng")) === false);
});

test("normalization preserves globe placement through studio saves", () => {
  const raw = {
    title: "Raw",
    tagline: "Tagline",
    scenes: {
      globe: {
        id: "globe",
        title: "Hub",
        narration: "n",
        hotspots: [
          { label: "Pakistan", blurb: "b", lat: 30.4, lng: 69.35, level: "country", countryId: "pk", childSceneId: "target", info: { title: "t", body: ["p"] } },
          { label: "Broken", blurb: "b", lat: "far", level: "galaxy", info: { title: "t", body: ["p"] } },
        ],
      },
      target: {
        id: "target",
        title: "Pakistan",
        narration: "n",
        hotspots: [{ label: "K2", blurb: "b", x: 50, y: 50, info: { title: "t", body: ["p"] } }],
      },
    },
  };
  const { pack } = normalizeGeneratedPack(raw);
  const spots = pack.scenes.globe.hotspots;
  assert.equal(spots[0].lat, 30.4);
  assert.equal(spots[0].lng, 69.35);
  assert.equal(spots[0].level, "country");
  assert.equal(spots[0].countryId, "pk");
  assert.equal(spots[1].lat, undefined); // invalid input dropped, not mangled
  assert.equal(spots[1].level, undefined);
  // and a saved globe pack (cleaned of the dropped junk) round-trips as a draft
  const clean = structuredClone(raw);
  clean.scenes.globe.hotspots = [clean.scenes.globe.hotspots[0]];
  const saved = normalizeForSave({ ...clean, id: "raw", view: "globe", rootSceneId: "globe" }, "raw");
  assert.deepEqual(saved.errors, []);
});

// ── agent helpers ─────────────────────────────────────────────────────────────
test("normalizeGlobeTopic always yields a usable shell", () => {
  assert.deepEqual(
    normalizeGlobeTopic(null, { title: "Our Amazing Earth" }),
    {
      title: "Our Amazing Earth",
      tagline: "Spin the globe and step inside the places of the world",
      emoji: "🌍",
      artStyle: normalizeGlobeTopic(null, {}).artStyle,
      welcome: "Spin the Earth and find a glowing place. Tap it to step inside and discover its story!",
    }
  );
  const shell = normalizeGlobeTopic({ title: "X", tagline: "t", emoji: "🗺️", artStyle: "a", welcome: "w" }, { title: "Ignored" });
  assert.deepEqual(shell, { title: "X", tagline: "t", emoji: "🗺️", artStyle: "a", welcome: "w" });
});

test("normalizePlaceResolution clamps coordinates and rejects nonsense", () => {
  const ok = normalizePlaceResolution({ name: "Eiffel Tower", level: "location", countryId: "FR", lat: 48.8584, lng: 2.2945, note: "Iron tower" });
  assert.equal(ok.place.name, "Eiffel Tower");
  assert.equal(ok.place.level, "location");
  assert.equal(ok.place.countryId, "fr");
  assert.deepEqual(ok.errors, []);

  const unlevelled = normalizePlaceResolution({ name: "A Place", lat: 10, lng: 20 });
  assert.equal(unplaceLevelledErrors(unlevelled), 0);
  assert.equal(unlevelled.place.level, "location");

  const bad = normalizePlaceResolution({ name: "", lat: 999 });
  assert.equal(bad.place, null);
  assert.ok(bad.errors.length >= 1);

  const notAPlace = normalizePlaceResolution({ error: "not a real place" });
  assert.equal(notAPlace.place, null);
  assert.match(notAPlace.errors[0], /not a real place/);
});
function unplaceLevelledErrors(r) {
  return r.errors.length;
}

test("buildGlobeHubSpot pins the doorway with the resolved place", () => {
  const spot = buildGlobeHubSpot({
    place: { name: "Lahore", level: "city", lat: 31.55, lng: 74.34, country: { id: "pk", name: "Pakistan" } },
    label: "Lahore",
    blurb: "The city of gardens",
    childSceneId: "lahore",
    info: { title: "Lahore", body: ["Welcome."] },
  });
  assert.deepEqual(
    { ...spot, info: undefined },
    {
      id: "lahore",
      label: "Lahore",
      blurb: "The city of gardens",
      lat: 31.55,
      lng: 74.34,
      level: "city",
      countryId: "pk",
      childSceneId: "lahore",
      info: undefined,
    }
  );
  assert.deepEqual(spot.info, { title: "Lahore", body: ["Welcome."] });
});

test("the globe scene prompt carries the place, coordinates and leaf rule", () => {
  const prompt = buildGlobeScenePrompt({
    topicTitle: "Our Amazing Earth",
    artStyle: "storybook",
    place: { name: "Lahore", level: "city", lat: 31.55, lng: 74.34, country: { id: "pk", name: "Pakistan" } },
    existingNames: ["Pakistan"],
  });
  assert.match(prompt, /"Lahore" in Pakistan/);
  assert.match(prompt, /31\.55/);
  assert.match(prompt, /never set childSceneId/s);
  assert.match(prompt, /Pakistan/); // existing places are listed as taken
  assert.match(buildPlaceResolutionPrompt({ query: "Eiffel Tower" }), /Eiffel Tower/);
});
