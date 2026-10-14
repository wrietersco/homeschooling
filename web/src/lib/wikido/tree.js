// Scene-tree helpers for the Wikido Studio. Pure functions over the pack's
// `scenes` map — no Firebase, no Vue — so they unit-test directly.
//
// The explorer's navigation IS the tree: the root scene is the entry point and
// each doorway hotspot (childSceneId) is an edge. Sibling order is therefore the
// order of doorway hotspots inside the parent — reordering children means
// swapping those doorways, never touching the scenes map keys.
//
// Hotspots that ALSO carry childTopicId are cross-topic doorways: their
// childSceneId belongs to another pack's namespace, so they are not edges of
// this pack's tree and every walk here skips them.

function opensLocal(spot) {
  return Boolean(spot?.childSceneId && !spot.childTopicId);
}

// Ordered scene list with every branch kept together: depth-first from
// the root along doorways (children in doorway order), then any orphan scenes
// appended at depth 0. Returns [{ id, depth, parentId|null }].
export function buildSceneTree(scenes, rootId) {
  const out = [];
  const seen = new Set();
  function walk(id, depth, parentId) {
      if (seen.has(id) || !scenes?.[id]) return;
      seen.add(id);
      out.push({ id, depth, parentId });
      for (const h of scenes[id].hotspots || []) {
        if (opensLocal(h)) walk(h.childSceneId, depth + 1, id);
      }
  }
  walk(rootId, 0, null);
  for (const id of Object.keys(scenes || {})) {
    if (!seen.has(id)) out.push({ id, depth: 0, parentId: null });
  }
  return out;
}

// The scene whose doorway opens this one (null for the root / orphans).
export function findParentSceneId(scenes, sceneId) {
  for (const [sid, s] of Object.entries(scenes || {})) {
    if ((s.hotspots || []).some((h) => h.childSceneId === sceneId && !h.childTopicId)) return sid;
  }
  return null;
}

// The ancestor chain of sceneId within its own topic, ROOT FIRST (excluding
// sceneId itself): [root, …, parent]. Empty for a root scene. Used when a
// cross-topic doorway lands deep inside another world — the entered scene keeps
// its natural breadcrumb trail back to that world's entrance.
export function ancestorChain(scenes, sceneId) {
  const chain = [];
  const seen = new Set();
  let current = sceneId;
  while (true) {
    seen.add(current);
    const parent = findParentSceneId(scenes, current);
    if (!parent || seen.has(parent)) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

// Sibling scene ids of sceneId, in display order (their doorways' order in the
// shared parent). Empty for the root and orphans.
export function siblingSceneIds(scenes, sceneId) {
  const parentId = findParentSceneId(scenes, sceneId);
  if (!parentId) return [];
  return (scenes[parentId].hotspots || []).filter((h) => h.childSceneId && !h.childTopicId).map((h) => h.childSceneId);
}

// Move a scene among its doorway siblings ("up" = earlier in the parent's
// doorway order). Returns a NEW scenes map with the parent's doorway hotspots
// swapped, or null when there is no adjacent sibling to swap with.
export function moveSceneSibling(scenes, sceneId, dir) {
  const parentId = findParentSceneId(scenes, sceneId);
  if (!parentId) return null;
  const parent = scenes[parentId];
  const ids = (parent.hotspots || []).filter((h) => h.childSceneId && !h.childTopicId).map((h) => h.childSceneId);
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
    for (const h of scenes[id].hotspots || []) if (h.childSceneId && !h.childTopicId) walk(h.childSceneId);
  };
  walk(sceneId);
  return [...out];
}

// Shared legality checks for re-parenting sceneId under targetParentId.
// ignoreCapacity: a move within the same picture adds no spot, so an already
// full picture (8 spots) may still be reordered.
function moveAllowed(scenes, sceneId, targetParentId, rootId, ignoreCapacity) {
  if (!scenes?.[sceneId] || !scenes?.[targetParentId]) return false;
  if (rootId && sceneId === rootId) return false; // the entrance defines the topic and never moves
  if (sceneId === targetParentId) return false;
  if (!ignoreCapacity && (scenes[targetParentId].hotspots || []).length >= 8) return false;
  return !subtreeSceneIds(scenes, sceneId).includes(targetParentId);
}

// Whether sceneId may be re-parented under targetParentId:
// both must exist; the moved scene can't be the root (rootId), itself, or land
// inside its own subtree (that would disconnect the branch); and the target
// picture has room for one more spot — unless the scene already hangs there
// (a reorder adds nothing).
export function canMoveScene(scenes, sceneId, targetParentId, rootId = null) {
  const sameParent = findParentSceneId(scenes, sceneId) === targetParentId;
  return moveAllowed(scenes, sceneId, targetParentId, rootId, sameParent);
}

// Move a scene (with its whole subtree) under targetParentId. The doorway that
// opened it travels along (label/blurb/info kept) and is re-inserted into the
// target parent's spots at insertIndex (end when null); removing the old
// doorway first shifts the slot, which is adjusted here. A scene has exactly
// one parent, so any OTHER spot that still opens it becomes a plain fact spot
// (a second doorway would fail save validation).
// Returns a NEW scenes map, or null when the move isn't allowed.
export function moveSceneTo(scenes, sceneId, targetParentId, insertIndex = null, rootId = null) {
  const oldParentId = findParentSceneId(scenes, sceneId);
  if (!moveAllowed(scenes, sceneId, targetParentId, rootId, oldParentId === targetParentId)) return null;
  const next = JSON.parse(JSON.stringify(scenes));
  let doorway = null;
  let removedIdx = -1;
  if (oldParentId) {
    const hotspots = next[oldParentId].hotspots;
    removedIdx = hotspots.findIndex((h) => h.childSceneId === sceneId);
    if (removedIdx >= 0) { doorway = hotspots[removedIdx]; hotspots.splice(removedIdx, 1); }
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
  let at = insertIndex === null ? target.hotspots.length : Math.max(0, Math.min(insertIndex, target.hotspots.length));
  if (oldParentId === targetParentId && removedIdx >= 0 && removedIdx < at) at -= 1; // the removal shifted the slot left
  target.hotspots.splice(at, 0, doorway);
  for (const s of Object.values(next)) {
    for (const h of s.hotspots || []) {
      if (h !== doorway && h.childSceneId === sceneId && !h.childTopicId) delete h.childSceneId;
    }
  }
  return next;
}

// Resolve a drop ONTO a row into a concrete move: { parentId, insertIndex, mode }
// or null. mode "into" nests under the row; "before"/"after" slot next to it in
// its parent's spots. A gap next to a row with no parent (the entrance or an
// unlinked scene) has no sibling list to join, so it nests under that row
// instead — the returned mode reflects that, so the drop indicator can match.
export function resolveDrop(scenes, dragSceneId, rowSceneId, mode, rootId = null) {
  if (!scenes?.[dragSceneId] || !scenes?.[rowSceneId] || dragSceneId === rowSceneId) return null;
  if (mode !== "before" && mode !== "after") {
    return canMoveScene(scenes, dragSceneId, rowSceneId, rootId) ? { parentId: rowSceneId, insertIndex: null, mode: "into" } : null;
  }
  const parentId = findParentSceneId(scenes, rowSceneId);
  if (!parentId) return canMoveScene(scenes, dragSceneId, rowSceneId, rootId) ? { parentId: rowSceneId, insertIndex: null, mode: "into" } : null;
  if (!canMoveScene(scenes, dragSceneId, parentId, rootId)) return null;
  const idx = scenes[parentId].hotspots.findIndex((h) => h.childSceneId === rowSceneId);
  return { parentId, insertIndex: mode === "after" ? idx + 1 : idx, mode };
}

// Resolve a drag-drop onto a row and perform it. Returns a NEW scenes map, or
// null when the drop is a no-op or disallowed.
export function moveSceneByDrop(scenes, dragSceneId, rowSceneId, mode, rootId = null) {
  const plan = resolveDrop(scenes, dragSceneId, rowSceneId, mode, rootId);
  return plan ? moveSceneTo(scenes, dragSceneId, plan.parentId, plan.insertIndex, rootId) : null;
}
