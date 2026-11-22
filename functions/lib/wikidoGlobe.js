// ── Globe worlds (view: "globe") ──────────────────────────────────────────────
// A globe topic is another form of immersive view: instead of entering through
// a picture, the child lands on a 3D globe whose SPOTS are doorways to scenes.
// The pack's ROOT scene is the globe hub — it renders no artwork of its own;
// its hotspots carry latitude/longitude and a zoom level instead of x/y
// percentages. Everything else (scene trees, fact cards, cross-topic doorways,
// artwork, audio) works exactly as in picture worlds.
//
// Shared by the web schema validator and the studio callables — keep both
// validateTopicPack copies calling these helpers so the shape rules stay in
// lockstep.
import { isLatLng, isLng, isValidSpotLevel, placeCatalog, catalogPlaceForSpot } from "./wikidoGazetteer.js";

export const GLOBE_VIEW = "globe";

export function isGlobePack(pack) {
  return pack?.view === GLOBE_VIEW;
}

// The root scene of a globe pack is the hub the globe renders.
export function isGlobeHub(pack, sceneId) {
  return isGlobePack(pack) && sceneId === pack?.rootSceneId;
}

// The doorway hotspots that place scenes on the globe (hub spots).
export function globeSpots(pack) {
  return isGlobePack(pack) ? pack.scenes?.[pack.rootSceneId]?.hotspots || [] : [];
}

// A globe place is ENABLED unless it says otherwise (`enabled: false`), so every
// world saved before places could be switched off keeps working untouched. A
// disabled place is a known pin that is not on the children's globe yet — it
// is the state every continent and country starts in, because none of them has
// a scene until the curator adds one.
export function isSpotEnabled(spot) {
  return spot?.enabled !== false;
}

// The places children can actually see and open on this globe.
export function enabledGlobeSpots(pack) {
  return globeSpots(pack).filter(isSpotEnabled);
}

// Validate the OPTIONAL geo fields any hotspot may carry (lat/lng, zoom level,
// country reference). Returns human-readable errors.
export function validateSpotGeo(spot, spotPath) {
  const errors = [];
  if (spot.lat !== undefined || spot.lng !== undefined) {
    if (!isLatLng(spot.lat) || !isLng(spot.lng)) {
      errors.push(`${spotPath}: lat/lng must be numbers (lat −90–90, lng −180–180)`);
    }
  }
  if (spot.level !== undefined && !isValidSpotLevel(spot.level)) {
    errors.push(`${spotPath}: level must be one of continent, country, city, location`);
  }
  return errors;
}

// Validate ONE hotspot of a globe hub: every spot on the globe is a doorway
// pinned to a place, with a zoom level that decides when it appears. Returns
// human-readable errors.
export function validateGlobeHubSpot(spot, spotPath) {
  const errors = validateSpotGeo(spot, spotPath);
  if (spot.enabled !== undefined && typeof spot.enabled !== "boolean") {
    errors.push(`${spotPath}: enabled, when present, must be true or false`);
  }
  // a disabled place is only a pin waiting for its scenes — nothing to open yet
  if (!spot.childSceneId && isSpotEnabled(spot)) {
    errors.push(`${spotPath}: an enabled globe spot must open a scene (childSceneId) — add a scene first, or switch the place off`);
  }
  if (!isLatLng(spot.lat) || !isLng(spot.lng)) {
    errors.push(`${spotPath}: a globe spot needs lat/lng so it can sit on the globe`);
  }
  if (!isValidSpotLevel(spot.level)) {
    errors.push(`${spotPath}: a globe spot needs a level — continent, country, city or location`);
  }
  return errors;
}

// The hub spot for a catalog place that has no scenes yet: a pin at the place's
// known coordinates, switched OFF, opening nothing. Switching it on needs a
// scene first (see validateGlobeHubSpot). Its card text is a stand-in so the
// spot always satisfies the shared "every spot has info" rule.
export function buildPlaceholderGlobeSpot(place) {
  return {
    id: place.spotId,
    label: place.name,
    blurb: `Explore ${place.name}`,
    lat: place.lat,
    lng: place.lng,
    level: place.level,
    ...(place.countryId ? { countryId: place.countryId } : {}),
    enabled: false,
    info: { title: place.name, body: [`${place.name} is coming soon — its scenes have not been added yet.`] },
  };
}

// The whole planet as the studio lists it: every catalog place (continents,
// then countries) paired with the spot that stands for it on this globe, if
// any. A place with no spot is simply "known but not added"; a spot that is
// not in the catalog (a city, a landmark) is a custom pin and is listed by the
// caller separately.
//   → [{ place, spot|null, state: "unadded"|"disabled"|"enabled" }]
export function globeDirectory(pack) {
  const spots = globeSpots(pack);
  const bySpot = new Map();
  for (const spot of spots) {
    const place = catalogPlaceForSpot(spot);
    if (place && !bySpot.has(place.spotId)) bySpot.set(place.spotId, spot);
  }
  return placeCatalog.map((place) => {
    const spot = bySpot.get(place.spotId) || null;
    return { place, spot, state: !spot ? "unadded" : isSpotEnabled(spot) ? "enabled" : "disabled" };
  });
}

// True when this topic still has no places on its globe (disabled places are
// not on the children's globe, so they don't count).
export function globeIsEmpty(pack) {
  return enabledGlobeSpots(pack).length === 0;
}
