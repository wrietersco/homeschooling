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
import { isLatLng, isLng, isValidSpotLevel } from "./wikidoGazetteer.js";

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
    errors.push(`${spotPath}: level must be one of country, city, location`);
  }
  return errors;
}

// Validate ONE hotspot of a globe hub: every spot on the globe is a doorway
// pinned to a place, with a zoom level that decides when it appears. Returns
// human-readable errors.
export function validateGlobeHubSpot(spot, spotPath) {
  const errors = validateSpotGeo(spot, spotPath);
  if (!spot.childSceneId) {
    errors.push(`${spotPath}: a globe spot must open a scene (childSceneId)`);
  }
  if (!isLatLng(spot.lat) || !isLng(spot.lng)) {
    errors.push(`${spotPath}: a globe spot needs lat/lng so it can sit on the globe`);
  }
  if (!isValidSpotLevel(spot.level)) {
    errors.push(`${spotPath}: a globe spot needs a level — country, city or location`);
  }
  return errors;
}

// True when this topic still has no places on its globe.
export function globeIsEmpty(pack) {
  return globeSpots(pack).length === 0;
}
