// Scene-tree helpers for the Wikido Studio. Pure functions over the pack's
// `scenes` map — no Firebase, no Vue — so they unit-test directly.
//
// The explorer's navigation IS the tree: the root scene is the entry point and
// each doorway hotspot (childSceneId) is an edge. Sibling order is therefore the
// order of doorway hotspots inside the parent — reordering children means
// swapping those doorways, never touching the scenes map keys.

// Ordered scene list exactly as the explorer traverses it: breadth-first from
// the root along doorways (children in doorway order), then any orphan scenes
// appended at depth 0. Returns [{ id, depth, parentId|null }].
export function buildSceneTree(scenes, rootId) {
  const out = [];
  const seen = new Set();
  const parentOf = {};
  let frontier = rootId && scenes?.[rootId] ? [rootId] : [];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id) || !scenes[id]) continue;
      seen.add(id);
      out.push({ id, depth, parentId: id === rootId ? null : parentOf[id] || null });
      for (const h of scenes[id].hotspots || []) {
        if (h.childSceneId && scenes[h.childSceneId] && !seen.has(h.childSceneId)) {
          parentOf[h.childSceneId] = id;
          next.push(h.childSceneId);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  for (const id of Object.keys(scenes)) {
    if (!seen.has(id)) out.push({ id, depth: 0, parentId: null });
  }
  return out;
}

// The scene whose doorway opens this one (null for the root / orphans).
export function findParentSceneId(scenes, sceneId) {
  for (const [sid, s] of Object.entries(scenes || {})) {
    if ((s.hotspots || []).some((h) => h.childSceneId === sceneId)) return sid;
  }
  return null;
}

// Sibling scene ids of sceneId, in display order (their doorways' order in the
// shared parent). Empty for the root and orphans.
export function siblingSceneIds(scenes, sceneId) {
  const parentId = findParentSceneId(scenes, sceneId);
  if (!parentId) return [];
  return (scenes[parentId].hotspots || []).filter((h) => h.childSceneId).map((h) => h.childSceneId);
}

// Move a scene among its doorway siblings ("up" = earlier in the parent's
// doorway order). Returns a NEW scenes map with the parent's doorway hotspots
// swapped, or null when there is no adjacent sibling to swap with.
export function moveSceneSibling(scenes, sceneId, dir) {
  const parentId = findParentSceneId(scenes, sceneId);
  if (!parentId) return null;
  const parent = scenes[parentId];
  const ids = (parent.hotspots || []).filter((h) => h.childSceneId).map((h) => h.childSceneId);
  const idx = ids.indexOf(sceneId);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= ids.length) return null;

  const next = JSON.parse(JSON.stringify(scenes)); // scenes may be reactive proxies
  const hotspots = next[parentId].hotspots;
  const a = hotspots.findIndex((h) => h.childSceneId === ids[idx]);
  const b = hotspots.findIndex((h) => h.childSceneId === ids[swapWith]);
  [hotspots[a], hotspots[b]] = [hotspots[b], hotspots[a]];
  return next;
}
