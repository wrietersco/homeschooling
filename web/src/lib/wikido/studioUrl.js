// Wikido Studio deep links (Platform → Wikido Studio). Pure functions.
//
//   /platform/wikido                          the studio, default world
//   /platform/wikido/:topicId                 a world (its entrance scene)
//   /platform/wikido/:topicId/:sceneId        a scene in the map of scenes
//   …?spot=<spotId>                           the spot/card being edited
//   …?wizard=place|scene|lens                 an open "Add a …" wizard
//   …?q=<text>&status=a,b                     map-of-scenes search + status filter
//
// As in the child view, the entrance scene never appears in the path.
import { buildWikidoLocation } from "./urlState.js";

export const STUDIO_WIZARDS = ["place", "scene", "lens"];
const ID_RE = /^[\w.-]{1,120}$/;
const id = (v) => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && ID_RE.test(s) ? s : "";
};
const text = (v) => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.slice(0, 120) : "";
};

export function parseStudioLocation(route) {
  const params = route?.params || {};
  const query = route?.query || {};
  const wizard = text(query.wizard);
  return {
    topicId: id(params.topicId),
    sceneId: id(params.sceneId),
    spot: id(query.spot),
    wizard: STUDIO_WIZARDS.includes(wizard) ? wizard : "",
    q: text(query.q),
    statuses: text(query.status).split(",").map((s) => s.trim()).filter((s) => /^[\w-]{1,30}$/.test(s)),
  };
}

export function buildStudioLocation(state = {}, { rootSceneId = "" } = {}) {
  const { topicId, sceneId, spot, wizard, q, statuses } = state;
  let path = "/platform/wikido";
  if (topicId) {
    path += `/${encodeURIComponent(topicId)}`;
    if (sceneId && sceneId !== rootSceneId) path += `/${encodeURIComponent(sceneId)}`;
  }
  const query = {};
  if (topicId && spot) query.spot = spot;
  if (topicId && STUDIO_WIZARDS.includes(wizard)) query.wizard = wizard;
  if (q) query.q = q;
  if (statuses?.length) query.status = [...statuses].sort().join(",");
  return { path, query };
}

// The child-facing deep link to the same place ("Open as child").
export function childLinkFor(topicId, sceneId, rootSceneId, spot = "") {
  const loc = buildWikidoLocation({ topicId, sceneId, card: spot }, { rootSceneId });
  const qs = new URLSearchParams(loc.query).toString();
  return qs ? `${loc.path}?${qs}` : loc.path;
}

// Does this router location equal the current route (path + query)?
export function sameLocation(a, route) {
  if (a.path !== route.path) return false;
  const keys = new Set([...Object.keys(a.query || {}), ...Object.keys(route.query || {})]);
  for (const k of keys) {
    const x = a.query?.[k] ?? "";
    const y = Array.isArray(route.query?.[k]) ? route.query[k][0] : route.query?.[k] ?? "";
    if (String(x) !== String(y)) return false;
  }
  return true;
}
