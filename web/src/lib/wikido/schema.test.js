import { describe, it, expect } from "vitest";
import { validateTopicPack, validateCrossTopicDoorways, validatePackCrossTopicDoorways } from "./schema.js";
import { wikidoTopicPacks } from "./index.js";
import livingThings from "./topics/living-things.js";
import { bundledWikidoWorlds } from "../../../../functions/lib/wikidoBundledWorlds.js";

// No bundled world carries a cross-topic doorway any more, but the field rules
// and registry resolution still must hold — tests hang a synthetic door on a
// pack copy for those.
function withWorldDoor(overrides = {}) {
  const pack = structuredClone(livingThings);
  pack.scenes["human-beings"].hotspots.push({
    id: "door-to-astronomy",
    label: "Visit the Stars",
    blurb: "Step into another world",
    x: 5,
    y: 5,
    childTopicId: "astronomy",
    childSceneId: "space-overview",
    info: { title: "A doorway", body: ["This door leads to another world."] },
    ...overrides,
  });
  return pack;
}
const astronomyWorld = { id: "astronomy", title: "Astronomy", scenes: { "space-overview": {} } };

// The published packs must always pass their own schema — they are the
// executable documentation of what a valid pack looks like.
describe("wikido topic schema", () => {
  it("accepts every published bundled pack", () => {
    for (const pack of wikidoTopicPacks) {
      expect(validateTopicPack(pack), pack.id).toEqual([]);
    }
  });

  it("resolves every cross-topic doorway in the published registry", () => {
    expect(validateCrossTopicDoorways(wikidoTopicPacks)).toEqual([]);
  });

  it("keeps the bundled-worlds manifest in sync with the real packs", () => {
    // the publish gate (functions) resolves cross-topic doorways against this
    // mirror of the bundled packs — drift here would wrongly block or wrongly
    // allow publishing
    expect(bundledWikidoWorlds.map((w) => ({ id: w.id, scenes: [...w.scenes].sort() })))
      .toEqual(wikidoTopicPacks.map((p) => ({ id: p.id, scenes: Object.keys(p.scenes).sort() })));
  });

  it("accepts a cross-topic doorway whose scene is not in this pack", () => {
    // the door's scene id belongs to the OTHER pack's namespace, so the local
    // check must not fire
    expect(validateTopicPack(withWorldDoor()).some((e) => e.includes("childSceneId"))).toBe(false);
  });

  it("rejects a cross-topic doorway pointing at an unknown world", () => {
    expect(validatePackCrossTopicDoorways(livingThings, [])).toEqual([]);
    const errors = validatePackCrossTopicDoorways(withWorldDoor(), []);
    expect(errors.some((e) => e.includes('childTopicId "astronomy" is not a known topic'))).toBe(true);
  });

  it("rejects a cross-topic doorway pointing at a missing scene in the target world", () => {
    const broken = withWorldDoor({ childSceneId: "no-such-scene" });
    const errors = validatePackCrossTopicDoorways(broken, [astronomyWorld]);
    expect(errors.some((e) => e.includes('does not exist in topic "astronomy"'))).toBe(true);
  });

  it("rejects a hotspot pointing at a scene that does not exist", () => {
    const broken = structuredClone(livingThings);
    broken.scenes["human-beings"].hotspots.find((h) => h.id === "your-body").childSceneId = "atlantis";
    const errors = validateTopicPack(broken);
    expect(errors.some((e) => e.includes('childSceneId "atlantis"'))).toBe(true);
  });

  it("enforces the cross-topic doorway field rules", () => {
    const pack = withWorldDoor();
    const spot = pack.scenes["human-beings"].hotspots.find((h) => h.id === "door-to-astronomy");

    const ownId = withWorldDoor();
    ownId.scenes["human-beings"].hotspots.find((h) => h.id === "door-to-astronomy").childTopicId = ownId.id;
    expect(validateTopicPack(ownId).some((e) => e.includes("must name a DIFFERENT topic"))).toBe(true);

    const noSlug = withWorldDoor();
    noSlug.scenes["human-beings"].hotspots.find((h) => h.id === "door-to-astronomy").childTopicId = "Astronomy!";
    expect(validateTopicPack(noSlug).some((e) => e.includes("childTopicId must be a kebab-case slug"))).toBe(true);

    const noScene = withWorldDoor();
    delete noScene.scenes["human-beings"].hotspots.find((h) => h.id === "door-to-astronomy").childSceneId;
    expect(validateTopicPack(noScene).some((e) => e.includes("needs a childSceneId"))).toBe(true);

    expect(spot.childTopicId).toBe("astronomy"); // the synthetic door stays intact
  });

  it("rejects hotspot coordinates outside 0–100", () => {
    const pack = structuredClone(livingThings);
    pack.scenes["human-body"].hotspots[0].x = 140;
    const errors = validateTopicPack(pack);
    expect(errors.some((e) => e.includes("x/y must be percentages"))).toBe(true);
  });

  it("rejects a scene without narration or an unknown rootSceneId", () => {
    const noNarration = structuredClone(livingThings);
    noNarration.scenes["broken-note"] = {
      id: "broken-note",
      title: "Broken",
      image: { src: "/wikido/x.svg", alt: "x" },
      narration: "   ",
      hotspots: [{ id: "a", label: "A", blurb: "b", x: 10, y: 10, info: { title: "T", body: ["p"] } }],
    };
    const errors = validateTopicPack(noNarration);
    expect(errors.some((e) => e.includes("narration"))).toBe(true);

    const badRoot = { ...livingThings, rootSceneId: "nope" };
    expect(validateTopicPack(badRoot).some((e) => e.includes("rootSceneId"))).toBe(true);
  });

  it("rejects hotspots missing the info card content", () => {
    const pack = structuredClone(livingThings);
    delete pack.scenes["human-body"].hotspots[1].info;
    const errors = validateTopicPack(pack);
    expect(errors.some((e) => e.includes("info { title, body } is required"))).toBe(true);
  });
});

// ── GLOBE worlds (view: "globe") ──────────────────────────────────────────────
// Globe worlds are grown by the superadmin through the Studio (pin a place →
// the agent writes an image scene and pins it). A synthetic pack here is the
// executable documentation of a valid globe world.
describe("wikido globe schema", () => {
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
  const globePack = () => ({
    id: "test-atlas",
    title: "Test Atlas",
    tagline: "Pinned places",
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
        image: { src: "/wikido/test-atlas/pakistan.jpg", alt: "p" },
        hotspots: [{ id: "k2", label: "K2", blurb: "A giant mountain", x: 50, y: 40, info: { title: "K2", body: ["Second highest."] } }],
      },
    },
  });

  it("accepts a globe world, hub relaxations included", () => {
    expect(validateTopicPack(globePack())).toEqual([]);
  });

  it("lets a fresh globe hub have no spots and no artwork", () => {
    // a brand-new globe world: just the hub, nothing pinned, nothing painted
    const fresh = {
      id: "fresh-globe",
      title: "Fresh Globe",
      tagline: "Nothing pinned yet",
      view: "globe",
      rootSceneId: "globe",
      scenes: {
        globe: { id: "globe", title: "Fresh Globe", narration: "Spin me!", image: { src: "", alt: "globe" }, hotspots: [] },
      },
    };
    expect(validateTopicPack(fresh, { allowMissingArtwork: true })).toEqual([]);
    // the hub never needs artwork, even at the strict publish gate
    expect(validateTopicPack(fresh)).toEqual([]);
  });

  it("requires every hub spot to be a doorway pinned to the planet", () => {
    const pack = globePack();

    const noScene = structuredClone(pack);
    delete noScene.scenes.globe.hotspots[0].childSceneId;
    expect(validateTopicPack(noScene).some((e) => e.includes("must open a scene"))).toBe(true);

    const noLatLng = structuredClone(pack);
    delete noLatLng.scenes.globe.hotspots[0].lat;
    expect(validateTopicPack(noLatLng).some((e) => e.includes("needs lat/lng"))).toBe(true);

    const noLevel = structuredClone(pack);
    delete noLevel.scenes.globe.hotspots[0].level;
    expect(validateTopicPack(noLevel).some((e) => e.includes("needs a level"))).toBe(true);
    expect(pack.scenes.globe.hotspots[0].label).toBe("Pakistan"); // the copies left the fixture alone
  });

  it("rejects out-of-range coordinates and unknown levels on any spot", () => {
    const badLat = structuredClone(globePack());
    badLat.scenes.globe.hotspots[0].lat = 130;
    expect(validateTopicPack(badLat).some((e) => e.includes("lat/lng must be numbers"))).toBe(true);

    const badLng = structuredClone(globePack());
    badLng.scenes.globe.hotspots[0].lng = -200;
    expect(validateTopicPack(badLng).some((e) => e.includes("lat/lng must be numbers"))).toBe(true);

    const badLevel = structuredClone(globePack());
    badLevel.scenes.globe.hotspots[0].level = "galaxy";
    expect(validateTopicPack(badLevel).some((e) => e.includes("level must be one of"))).toBe(true);

    // geo fields are validated on ordinary scene spots too (a deeper scene may
    // also carry a place reference one day)
    const sceneSpot = structuredClone(globePack());
    sceneSpot.scenes.pakistan.hotspots[0].lat = 999;
    expect(validateTopicPack(sceneSpot).some((e) => e.includes("lat/lng must be numbers"))).toBe(true);
  });

  it("rejects an unknown view value", () => {
    const pack = globePack();
    pack.view = "hologram";
    expect(validateTopicPack(pack).some((e) => e.includes('view must be "globe"'))).toBe(true);
  });
});
