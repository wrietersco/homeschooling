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

// ── Free drag-and-drop ────────────────────────────────────────────────────────

// Ids of every scene inside sceneId's subtree (including itself).
export function subtreeSceneIds(scenes, sceneId) {
  const out = new Set();
  const walk = (id) => {
    if (out.has(id) || !scenes?.[id]) return;
    out.add(id);
    for (const h of scenes[id].hotspots || []) if (h.childSceneId) walk(h.childSceneId);
  };
  walk(sceneId);
  return [...out];
}

// Whether sceneId may be re-parented under targetParentId:
// both must exist; the moved scene can't be the root; the target can't be the
// scene itself or inside its subtree (that would disconnect the branch); and
// the target picture has room for one more spot.
export function canMoveScene(scenes, sceneId, targetParentId) {
  if (!scenes?.[sceneId] || !scenes?.[targetParentId]) return false;
  if (sceneId === targetParentId) return false;
  if ((scenes[targetParentId].hotspots || []).length >= 8) return false;
  return !subtreeSceneIds(scenes, sceneId).includes(targetParentId);
}

// Move a scene (with its whole subtree) under targetParentId. The doorway that
// opened it travels along (label/blurb/info kept) and is re-inserted into the
// target parent's spots at insertIndex (end when null). Removing the old
// doorway first shifts later insert positions, which is handled here.
// Returns a NEW scenes map, or null when the move isn't allowed.
export function moveSceneTo(scenes, sceneId, targetParentId, insertIndex = null) {
  if (!canMoveScene(scenes, sceneId, targetParentId)) return null;
  const next = JSON.parse(JSON.stringify(scenes));
  const oldParentId = findParentSceneId(next, sceneId);
  let doorway = null;
  if (oldParentId) {
    const hotspots = next[oldParentId].hotspots;
    const idx = hotspots.findIndex((h) => h.childSceneId === sceneId);
    if (idx >= 0) { doorway = hotspots[idx]; hotspots.splice(idx, 1); }
  }
  if (!doorway) {
    doorway = {
      id: `open-${sceneId}`,
      label: next[sceneId].title,
      blurb: "",
      x: 50, y: 50,
      childSceneId: sceneId,
      info: { title: next[sceneId].title, body: [next[sceneId].narration || ""].filter(Boolean) },
    };
  }
  doorway.childSceneId = sceneId;
  const target = next[targetParentId];
  if (target.hotspots.some((h) => h.id === doorway.id)) doorway.id = `${doorway.id}-moved`;
  const at = insertIndex === null ? target.hotspots.length : Math.max(0, Math.min(insertIndex, target.hotspots.length));
  target.hotspots.splice(at, 0, doorway);
  return next;
}
