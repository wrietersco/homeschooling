// "Loose scenes": scenes that no spot leads to, so children can never reach
// them. They are harmless on their own (the child loader ignores them) but they
// clutter a world and used to blank a whole globe. Pure helpers: find them, fix
// them (attach under a picture, or delete) and explain them in plain language.
import { normalizePackForLoad, validateTopicPack } from "./schema.js";

const opensLocal = (h) => Boolean(h?.childSceneId && !h.childTopicId);
export const MAX_SPOTS_PER_SCENE = 8;

export function reachableSceneIds(scenes, rootId) {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !scenes?.[id]) continue;
    seen.add(id);
    for (const h of scenes[id].hotspots || []) if (opensLocal(h)) stack.push(h.childSceneId);
  }
  return seen;
}

// → { ids: [every loose scene], branches: [{ id, title, ids, count }] }
// A branch is a loose scene that no OTHER loose scene opens, plus everything
// loose under it — the unit you attach or delete as one piece.
export function loosePlan(scenes, rootId) {
  const reach = reachableSceneIds(scenes, rootId);
  const ids = Object.keys(scenes || {}).filter((id) => !reach.has(id));
  const loose = new Set(ids);
  const opened = new Set();
  for (const id of ids) {
    for (const h of scenes[id].hotspots || []) {
      if (opensLocal(h) && loose.has(h.childSceneId) && h.childSceneId !== id) opened.add(h.childSceneId);
    }
  }
  const heads = ids.filter((id) => !opened.has(id));
  const taken = new Set();
  const branches = [];
  const collect = (head) => {
    const out = [];
    const stack = [head];
    while (stack.length) {
      const id = stack.pop();
      if (taken.has(id) || !loose.has(id)) continue;
      taken.add(id);
      out.push(id);
      for (const h of scenes[id].hotspots || []) if (opensLocal(h)) stack.push(h.childSceneId);
    }
    return out;
  };
  for (const head of heads) branches.push({ id: head, title: scenes[head].title || head, ids: collect(head) });
  // a pure cycle of loose scenes has no head: take the first untaken one
  for (const id of ids) if (!taken.has(id)) branches.push({ id, title: scenes[id].title || id, ids: collect(id) });
  branches.forEach((b) => { b.count = b.ids.length; });
  return { ids, branches };
}

// NEW scenes map without the given scenes (stray spots that opened them are
// turned back into fact spots, never left dangling).
export function removeScenes(scenes, removeIds) {
  const doomed = new Set(removeIds);
  const next = {};
  for (const [id, s] of Object.entries(scenes || {})) {
    if (doomed.has(id)) continue;
    next[id] = {
      ...s,
      hotspots: (s.hotspots || []).map((h) => {
        if (!opensLocal(h) || !doomed.has(h.childSceneId)) return h;
        const { childSceneId, ...rest } = h; // eslint-disable-line no-unused-vars
        return rest;
      }),
    };
  }
  return next;
}

export const removeAllLoose = (scenes, rootId) => removeScenes(scenes, loosePlan(scenes, rootId).ids);

// Scenes a loose branch can be attached under: reachable, with room for a spot.
export function attachTargets(scenes, rootId, { excludeHub = false } = {}) {
  const reach = reachableSceneIds(scenes, rootId);
  return [...reach]
    .filter((id) => !(excludeHub && id === rootId) && (scenes[id].hotspots || []).length < MAX_SPOTS_PER_SCENE)
    .map((id) => ({ id, title: scenes[id].title || id }));
}

// NEW scenes map where `parentId` gains a spot that opens `branchHeadId`.
export function attachBranch(scenes, branchHeadId, parentId) {
  const head = scenes?.[branchHeadId];
  const parent = scenes?.[parentId];
  if (!head || !parent) return scenes;
  const used = new Set((parent.hotspots || []).map((h) => h.id));
  let id = `open-${branchHeadId}`.slice(0, 60);
  let n = 2;
  while (used.has(id)) id = `open-${branchHeadId}-${n++}`.slice(0, 60);
  const k = (parent.hotspots || []).length;
  const spot = {
    id,
    label: String(head.title || "New scene").slice(0, 60),
    blurb: String(head.title || "").slice(0, 90) || "Step inside",
    x: 15 + ((k * 23) % 70),
    y: 30 + ((k * 17) % 45),
    childSceneId: branchHeadId,
    info: { title: head.title || "New scene", body: [head.narration || head.title || "Explore this place."] },
  };
  return { ...scenes, [parentId]: { ...parent, hotspots: [...(parent.hotspots || []), spot] } };
}

// Turn the validator's technical sentences into something a beginner can act on.
function friendly(e, scenes) {
  const art = /^scenes\.([^:]+): image\.src is required/.exec(e);
  if (art) return `“${scenes?.[art[1]]?.title || art[1]}” has no picture yet — paint its artwork before publishing.`;
  return e;
}

// What the child loader would do with this world, in plain language.
// → { blockers: [{ key, text }], notes: [{ key, text }] }
// blockers = the world would fail to load for children; notes = things that get
// quietly left out (loose scenes, switched-off places).
export function publishChecks(pack) {
  const blockers = [];
  const notes = [];
  if (!pack?.scenes) return { blockers, notes };
  // the studio's edit form carries only scenes + metadata: give it the identity
  // fields a saved world always has, so only real problems are reported
  const copy = JSON.parse(JSON.stringify(pack));
  if (!copy.id) copy.id = "world";
  if (!copy.title) copy.title = "World";
  if (!copy.tagline) copy.tagline = "World";
  const loaded = normalizePackForLoad(copy);
  for (const e of validateTopicPack(loaded)) blockers.push({ key: "invalid", text: friendly(e, pack.scenes) });
  const plan = loosePlan(pack.scenes, pack.rootSceneId);
  if (plan.ids.length) {
    const n = plan.ids.length;
    notes.push({
      key: "loose",
      text: `${n} loose ${n === 1 ? "scene" : "scenes"} — no picture leads to ${n === 1 ? "it" : "them"}, so children can't see ${n === 1 ? "it" : "them"}. Attach or delete ${n === 1 ? "it" : "them"} in “Loose scenes”.`,
    });
  }
  if (pack.view === "globe") {
    const hub = pack.scenes[pack.rootSceneId];
    const off = (hub?.hotspots || []).filter((h) => h.enabled === false);
    if (off.length) notes.push({ key: "off", text: `${off.length} ${off.length === 1 ? "place is" : "places are"} switched off, so children won't see ${off.length === 1 ? "it" : "them"} yet.` });
  }
  return { blockers, notes };
}
