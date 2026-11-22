// Deep links for the child-facing Wikido. Pure functions — no Vue, no router —
// so URL ↔ state parsing unit-tests directly.
//
// URL scheme (every id is the readable id that already exists in the pack):
//
//   /wikido                              the shelf (topic list)
//   /wikido/:topicId                     a world, on its root scene (hub/globe)
//   /wikido/:topicId/:sceneId            a scene inside it
//   …?card=<spotId>                      the discovery card open on that scene
//   …?at=<lat>,<lng>,<zoom>              globe camera (globe hub only)
//   …?intro=0|1                          narration panel folded (0) / open (1);
//                                        omitted = the viewport's default
//
// The root scene never appears in the path (`/wikido/:topicId` IS the root),
// so there is exactly one canonical URL per place.
import { ancestorChain } from "./tree.js";
import { isGlobePack, isSpotEnabled } from "../../../../functions/lib/wikidoGlobe.js";

const ID_RE = /^[\w.-]{1,120}$/;
const cleanId = (v) => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && ID_RE.test(s) ? s : "";
};
const first = (v) => (Array.isArray(v) ? v[0] : v);

const round = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

// "lat,lng,zoom" ⇄ { lat, lng, zoom } — null for anything malformed or out of range.
export function parseAt(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng, zoom] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (parts.length === 3 && !(zoom >= 1)) return null;
  return { lat, lng, zoom: parts.length === 3 ? zoom : null };
}

export function formatAt({ lat, lng, zoom }) {
  if (![lat, lng].every(Number.isFinite)) return "";
  const base = `${round(lat, 2)},${round(lng, 2)}`;
  return Number.isFinite(zoom) ? `${base},${round(zoom, 2)}` : base;
}

// vue-router route (or anything with { params, query }) → plain state.
export function parseWikidoLocation(route) {
  const params = route?.params || {};
  const query = route?.query || {};
  const intro = first(query.intro);
  return {
    topicId: cleanId(params.topicId),
    sceneId: cleanId(params.sceneId),
    card: cleanId(query.card),
    at: parseAt(first(query.at)),
    intro: intro === "0" ? false : intro === "1" ? true : null,
  };
}

// state → router location { path, query }. `rootSceneId` lets the root scene
// collapse into the topic URL. Empty/default fields are left out.
export function buildWikidoLocation(state = {}, { rootSceneId = "" } = {}) {
  const { topicId, sceneId, card, at, intro } = state;
  if (!topicId) return { path: "/wikido", query: {} };
  let path = `/wikido/${encodeURIComponent(topicId)}`;
  if (sceneId && sceneId !== rootSceneId) path += `/${encodeURIComponent(sceneId)}`;
  const query = {};
  if (card) query.card = card;
  if (at) {
    const s = formatAt(at);
    if (s) query.at = s;
  }
  if (intro === true) query.intro = "1";
  if (intro === false) query.intro = "0";
  return { path, query };
}

// ── validating a target against the loaded pack ──────────────────────────────

// Scenes a child can reach. On a globe the hub's switched-off places are not on
// the planet, so scenes only reachable through them are unavailable.
export function reachableSceneIds(pack) {
  const scenes = pack?.scenes || {};
  const out = new Set();
  const globe = isGlobePack(pack);
  const walk = (id) => {
    if (out.has(id) || !scenes[id]) return;
    out.add(id);
    for (const h of scenes[id].hotspots || []) {
      if (!h.childSceneId || h.childTopicId) continue;
      if (globe && id === pack.rootSceneId && !isSpotEnabled(h)) continue;
      walk(h.childSceneId);
    }
  };
  walk(pack?.rootSceneId);
  return out;
}

// Can this spot be opened as a card on this scene?
export function cardAvailable(pack, sceneId, cardId) {
  const scene = pack?.scenes?.[sceneId];
  if (!scene || !cardId) return false;
  const spot = (scene.hotspots || []).find((h) => h.id === cardId);
  if (!spot) return false;
  if (isGlobePack(pack) && sceneId === pack.rootSceneId) {
    return isSpotEnabled(spot) && Number.isFinite(+spot.lat) && Number.isFinite(+spot.lng);
  }
  return true;
}

// Decide where a (possibly stale) link really lands. Unknown or unreachable
// scene → the nearest reachable ancestor (else the root); unknown card → no
// card. `notice` is a friendly sentence for a toast, or "".
export function resolveWikidoTarget(pack, { sceneId, card }) {
  const rootId = pack.rootSceneId;
  const reachable = reachableSceneIds(pack);
  let notice = "";
  let landed = sceneId || rootId;
  if (!reachable.has(landed)) {
    const fallback = [...ancestorChain(pack.scenes, landed)].reverse().find((id) => reachable.has(id)) || rootId;
    const title = pack.scenes[fallback]?.title || pack.title;
    notice = `That place isn't open any more, so we brought you to ${title}.`;
    landed = fallback;
    return { sceneId: landed, card: "", notice };
  }
  let cardId = card || "";
  if (cardId && !cardAvailable(pack, landed, cardId)) {
    cardId = "";
    notice = "That card isn't there any more — here's the whole place instead.";
  }
  return { sceneId: landed, card: cardId, notice };
}

// Where the journey (breadcrumb path) of a cold-opened scene runs: its natural
// ancestors, root first, then the scene itself.
export function coldJourneySegment(pack, sceneId) {
  return { topicId: pack.id, scenes: [...ancestorChain(pack.scenes, sceneId), sceneId] };
}

// provide/inject key: WikidoView provides share({ withCard, camera }); scene, globe and card show a Copy-link button only when provided.
export const WIKIDO_SHARE = Symbol("wikidoShare");
