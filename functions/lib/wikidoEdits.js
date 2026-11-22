import { sceneChildIds } from "./wikidoPerspectives.js";

// Repair editor leftovers before saving, without inventing a parent relationship.
export function repairWikidoEdits(input, worlds = []) {
  const pack = structuredClone(input);
  const repairs = [];
  const known = [...new Map(worlds.map(world => [world.id, world])).values()];
  for (const [id, scene] of Object.entries(pack.scenes || {})) {
    for (const spot of scene.hotspots || []) {
      if (!spot.childSceneId || spot.childTopicId || pack.scenes[spot.childSceneId]) continue;
      const targets = known.filter(w => w.id !== pack.id &&
        (Array.isArray(w.scenes) ? w.scenes.includes(spot.childSceneId) : Boolean(w.scenes?.[spot.childSceneId])));
      if (targets.length === 1) {
        spot.childTopicId = targets[0].id;
        repairs.push(`Restored the world link for “${spot.label}”.`);
      } else if (!targets.length) {
        delete spot.childSceneId;
        repairs.push(`Changed “${spot.label}” to a fact because its scene was deleted.`);
      }
    }
  }
  if (!pack.scenes?.[pack.rootSceneId]) return { pack, repairs };
  const reachable = new Set();
  function walk(id) {
    if (reachable.has(id) || !pack.scenes[id]) return;
    reachable.add(id);
    // doorways AND perspective pictures: a lens is reached from its base scene
    for (const childId of sceneChildIds(pack.scenes[id], pack.id)) walk(childId);
  }
  walk(pack.rootSceneId);
  for (const id of Object.keys(pack.scenes)) {
    if (!reachable.has(id)) {
      repairs.push(`Removed disconnected scene “${pack.scenes[id].title || id}”.`);
      delete pack.scenes[id];
    }
  }
  // a perspective list never points at a scene that is gone
  for (const scene of Object.values(pack.scenes)) {
    if (!Array.isArray(scene.perspectives)) continue;
    const keep = scene.perspectives.filter((e) => pack.scenes[e?.sceneId]);
    if (keep.length !== scene.perspectives.length) {
      scene.perspectives = keep;
      repairs.push(`Removed a perspective whose picture was deleted from “${scene.title}”.`);
    }
  }
  return { pack, repairs };
}
