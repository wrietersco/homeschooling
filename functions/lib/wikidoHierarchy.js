// ── Cross-topic doorways ──────────────────────────────────────────────────────
// A hotspot normally opens a scene in its OWN pack (childSceneId alone). When it
// also names childTopicId — a DIFFERENT pack — it becomes a cross-topic doorway:
// the door leads to childSceneId inside that other world (e.g. a "Solar System"
// scene in the Astronomy world opened from the Planet Earth world). The target
// lives in another pack, so every local-tree walk must skip these edges.

// True when the spot opens a scene in another topic (requires pack.id context to
// be definitive; without it, any declared childTopicId counts as cross).
export function isCrossTopicDoorway(spot, packId = null) {
  return Boolean(spot?.childTopicId && spot.childTopicId !== packId);
}

// Every cross-topic doorway in a pack: [{ sceneId, spotId, topicId, targetSceneId }].
export function crossTopicDoorways(pack) {
  const out = [];
  for (const [sceneId, scene] of Object.entries(pack?.scenes || {})) {
    for (const spot of Array.isArray(scene?.hotspots) ? scene.hotspots : []) {
      if (isCrossTopicDoorway(spot, pack?.id)) {
        out.push({ sceneId, spotId: spot.id, topicId: spot.childTopicId, targetSceneId: spot.childSceneId });
      }
    }
  }
  return out;
}

// Check ONE pack's cross-topic doorways against a registry of other packs.
// Returns human-readable errors for doors pointing at a missing world or a
// missing scene inside that world. Registry entries may carry their scenes as a
// map (real packs) or as an array of ids (the bundled-worlds mirror).
export function validatePackCrossTopicDoorways(pack, knownPacks) {
  const byId = new Map((knownPacks || []).filter((p) => p && p.id !== pack?.id).map((p) => [p.id, p]));
  const hasScene = (target, sceneId) =>
    Array.isArray(target.scenes) ? target.scenes.includes(sceneId) : Boolean(target.scenes?.[sceneId]);
  const errors = [];
  for (const door of crossTopicDoorways(pack)) {
    const target = byId.get(door.topicId);
    if (!target) {
      errors.push(`scenes.${door.sceneId}.hotspots[${door.spotId}]: childTopicId "${door.topicId}" is not a known topic`);
    } else if (!hasScene(target, door.targetSceneId)) {
      errors.push(`scenes.${door.sceneId}.hotspots[${door.spotId}]: scene "${door.targetSceneId}" does not exist in topic "${door.topicId}"`);
    }
  }
  return errors;
}

// Mutual check over a whole registry: every pack's cross-topic doorways must
// resolve against the other packs in the list.
export function validateCrossTopicDoorways(packs) {
  const list = Array.isArray(packs) ? packs : Object.values(packs || {});
  return list.flatMap((pack) => validatePackCrossTopicDoorways(pack, list));
}

// Doorways are the canonical hierarchy for both the studio and explorer.
// packId (when given) lets declared cross-topic doorways opt out of the local
// tree — their childSceneId belongs to another pack's namespace.
export function validateSceneHierarchy(scenes, rootSceneId, packId = null) {
  if (!scenes || typeof scenes !== "object") return [];
  const errors = [];
  const local = (spot) => spot?.childSceneId && !isCrossTopicDoorway(spot, packId);
  const parents = new Map();
  for (const [id, scene] of Object.entries(scenes)) {
    for (const spot of Array.isArray(scene?.hotspots) ? scene.hotspots : []) {
      if (!local(spot)) continue;
      const child = spot.childSceneId;
      if (!scenes[child]) continue;
      if (child === rootSceneId) errors.push(`Scene "${id}" links back to the root scene`);
      if (parents.has(child)) errors.push(`Scene "${child}" has multiple doorways/parents: "${parents.get(child)}" and "${id}"`);
      parents.set(child, id);
    }
  }
  const active = new Set();
  const visited = new Set();
  function walk(id) {
    if (active.has(id)) { errors.push(`Hierarchy cycle at scene "${id}"`); return; }
    if (visited.has(id) || !scenes[id]) return;
    visited.add(id);
    active.add(id);
    for (const spot of Array.isArray(scenes[id]?.hotspots) ? scenes[id].hotspots : []) {
      if (local(spot)) walk(spot.childSceneId);
    }
    active.delete(id);
  }
  walk(rootSceneId);
  for (const id of Object.keys(scenes)) {
    if (!visited.has(id)) errors.push(`Scene "${id}" is unreachable from root "${rootSceneId}"`);
  }
  // Also detect cycles in disconnected branches.
  for (const id of Object.keys(scenes)) walk(id);
  return errors;
}

// A generator must declare the complete nested tree independently of its
// scene content. Check every edge, its doorway, order and scene coverage.
export function validateDeclaredHierarchy(pack, hierarchy) {
  const errors = [];
  const seen = new Set();
  function walk(node, parentId = null) {
    if (!node || typeof node !== "object" || !Array.isArray(node.children)) {
      errors.push("hierarchy nodes require sceneId and children array"); return;
    }
    const id = node.sceneId;
    if (!pack.scenes?.[id]) { errors.push(`hierarchy references missing scene "${id}"`); return; }
    if (seen.has(id)) { errors.push(`hierarchy repeats scene "${id}"`); return; }
    seen.add(id);
    if (parentId === null && id !== pack.rootSceneId) errors.push("hierarchy root must match rootSceneId");
    if (parentId !== null) {
      const spot = pack.scenes[parentId].hotspots.find((h) => h.id === node.hotspotId);
      if (!spot || spot.childSceneId !== id) errors.push(`hierarchy edge "${parentId}" → "${id}" does not match hotspot "${node.hotspotId}"`);
    }
    const children = pack.scenes[id].hotspots
      .filter((h) => h.childSceneId && !isCrossTopicDoorway(h, pack.id))
      .map((h) => h.childSceneId);
    if (JSON.stringify(children) !== JSON.stringify(node.children.map((n) => n?.sceneId))) {
      errors.push(`hierarchy children/order for "${id}" do not match its doorways`);
    }
    for (const child of node.children) walk(child, id);
  }
  walk(hierarchy);
  for (const id of Object.keys(pack.scenes || {})) if (!seen.has(id)) errors.push(`hierarchy omits scene "${id}"`);
  return errors;
}
