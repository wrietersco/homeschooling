// Pure view-model helpers for the Wikido Studio. No Vue, no Firebase — so the
// plain-language wording the studio shows (what a spot does, what deleting a
// scene removes, which scenes need attention) is unit-tested.
//
// Vocabulary (one word per idea): a topic is a MAP of SCENES; a scene is a
// picture with SPOTS; a spot either SHOWS A FACT, OPENS another scene in this
// world, or OPENS A WHOLE OTHER WORLD (cross-topic doorway: childTopicId +
// childSceneId — the scene id lives in that other world's namespace).
//
// `worlds` (optional) is a Map of OTHER topic ids → { title, scenes, status } —
// the studio passes the rest of the catalog so cross-topic doorways can be named
// and checked. Without it, cross doorways still work, just less specific.

const hasArtwork = (scene) => /^(https?:\/\/|\/wikido\/)/.test(String(scene?.image?.src || ""));
const isWorldDoor = (spot) => Boolean(spot?.childSceneId && spot.childTopicId);
const opensLocalScene = (spot) => Boolean(spot?.childSceneId && !spot.childTopicId);

// What tapping this spot does, in words a curator can read at a glance.
// → { kind: "fact"|"scene"|"world"|"broken", text, targetId|null }
export function spotOutcome(scenes, spot, worlds = null) {
  if (!spot?.childSceneId) return { kind: "fact", text: "Shows a fact card", targetId: null };
  if (isWorldDoor(spot)) {
    const world = worlds instanceof Map ? worlds.get(spot.childTopicId) : null;
    const sceneTitle = world?.scenes?.[spot.childSceneId]?.title || spot.childSceneId;
    return {
      kind: "world",
      cross: true,
      worldId: spot.childTopicId,
      targetId: spot.childSceneId,
      text: world
        ? `Opens “${sceneTitle}” in the world “${world.title}”${world.status && world.status !== "published" ? " (draft)" : ""}`
        : `Opens a scene in another world (“${spot.childTopicId}”)`,
    };
  }
  const target = scenes?.[spot.childSceneId];
  if (!target) return { kind: "broken", text: "Opens a scene that no longer exists", targetId: null };
  return { kind: "scene", text: `Opens “${target.title}”`, targetId: target.id };
}

// Ready / needs-attention state shown as a dot next to every scene in the map.
// globeRootId (a view:"globe" pack's root) is the globe hub: it renders code,
// never artwork, and its spots are pinned places rather than picture pins.
// → { key: "ready"|"needs-artwork"|"needs-spots"|"broken-link", label }
export function sceneStatus(scenes, scene, worlds = null, globeRootId = null) {
  if (!scene) return { key: "needs-spots", label: "Missing" };
  const isHub = globeRootId !== null && scene.id === globeRootId;
  if ((scene.hotspots || []).some((h) => opensLocalScene(h) && !scenes?.[h.childSceneId])) {
    return { key: "broken-link", label: "A spot opens a missing scene" };
  }
  // a cross-topic doorway into an unknown world is not a broken scene — the
  // whole-topic checklist below reports it as its own warning
  if (worlds instanceof Map) {
    const unknownWorld = (scene.hotspots || []).some((h) => isWorldDoor(h) && !worlds.has(h.childTopicId));
    if (unknownWorld) return { key: "broken-link", label: "A spot opens an unknown world" };
  }
  if (!(scene.hotspots || []).length) {
    return isHub ? { key: "needs-spots", label: "No places yet" } : { key: "needs-spots", label: "No spots yet" };
  }
  if (!isHub && !hasArtwork(scene)) return { key: "needs-artwork", label: "Needs artwork" };
  return { key: "ready", label: "Ready" };
}

// Every scene reachable ONLY through sceneId: the scene itself plus the scenes
// whose EVERY inbound doorway hangs inside that set. Scenes SHARED with the
// rest of the topic — also opened from a spot outside this branch — are NOT
// included, so deleting a branch leaves them standing for their other doors.
export function descendantSceneIds(scenes, sceneId) {
  const candidates = new Set();
  const walk = (id) => {
    if (candidates.has(id) || !scenes?.[id]) return;
    candidates.add(id);
    for (const h of scenes[id].hotspots || []) if (opensLocalScene(h)) walk(h.childSceneId);
  };
  walk(sceneId);
  if (!candidates.has(sceneId)) return [];
  // Drop anything that also hangs elsewhere — repeated, because removing a
  // scene can externalize the scenes that hung only through it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...candidates]) {
      if (id === sceneId) continue;
      const external = Object.entries(scenes || {}).some(([sid, s]) =>
        !candidates.has(sid) && (s.hotspots || []).some((h) => opensLocalScene(h) && h.childSceneId === id)
      );
      if (external) { candidates.delete(id); changed = true; }
    }
  }
  return [...candidates];
}

// Plain-language consequences of deleting a scene, for the confirm dialog.
// → { deeper: [titles], openedBy: [{ sceneId, spotId, label, sceneTitle }] }
export function deletePlan(scenes, sceneId) {
  const subtree = descendantSceneIds(scenes, sceneId);
  const subtreeSet = new Set(subtree);
  const openedBy = [];
  for (const [sid, s] of Object.entries(scenes || {})) {
    for (const h of s.hotspots || []) {
      if (h.childSceneId === sceneId && opensLocalScene(h) && !subtreeSet.has(sid)) {
        openedBy.push({ sceneId: sid, spotId: h.id, label: h.label, sceneTitle: s.title });
      }
    }
  }
  return {
    deeper: subtree.filter((id) => id !== sceneId).map((id) => scenes[id].title),
    openedBy,
  };
}

// Returns a NEW scenes map with `sceneId` removed. With withDeeper the whole
// subtree goes too. Spots elsewhere that opened a removed scene are turned back
// into fact spots — never left dangling (a dangling childSceneId fails
// validation and would break the child's screen).
export function deleteSceneFrom(scenes, sceneId, { withDeeper = false } = {}) {
  const doomed = new Set(withDeeper ? descendantSceneIds(scenes, sceneId) : [sceneId]);
  const next = {};
  for (const [sid, s] of Object.entries(scenes || {})) {
    if (doomed.has(sid)) continue;
    next[sid] = {
      ...s,
      hotspots: (s.hotspots || []).map((h) => {
        if (!opensLocalScene(h) || !doomed.has(h.childSceneId)) return h;
        const { childSceneId, ...rest } = h; // eslint-disable-line no-unused-vars
        return rest;
      }),
    };
  }
  if (!withDeeper) {
    const parentId = deletePlan(scenes, sceneId).openedBy[0]?.sceneId;
    const parent = next[parentId];
    if (parent) {
      const ids = new Set(parent.hotspots.map(h => h.id));
      for (const spot of scenes[sceneId]?.hotspots || []) {
        if (!opensLocalScene(spot) || !next[spot.childSceneId]) continue;
        let id = spot.id;
        let suffix = 2;
        while (ids.has(id)) id = `${spot.id}-${suffix++}`;
        ids.add(id);
        parent.hotspots.push({ ...spot, id });
      }
    }
  }
  return next;
}

// Whole-topic checklist shown above the map. Plain sentences, one per problem.
// globeRootId marks a view:"globe" pack's hub so its artwork-less state is not
// flagged as a defect and its wording talks about places, not pictures.
// → [{ sceneId, level: "error"|"warn", text }]
export function topicHealth(scenes, rootSceneId, worlds = null, globeRootId = null) {
  const issues = [];
  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id) || !scenes?.[id]) return;
    reachable.add(id);
    for (const h of scenes[id].hotspots || []) if (opensLocalScene(h)) walk(h.childSceneId);
  };
  walk(rootSceneId);

  for (const [id, s] of Object.entries(scenes || {})) {
    if (!reachable.has(id)) {
      issues.push({ sceneId: id, level: "error", text: `“${s.title}” isn’t opened by any spot, so children can never reach it.` });
    }
    const isHub = globeRootId !== null && id === globeRootId;
    const st = sceneStatus(scenes, s, worlds, globeRootId);
    if (st.key === "broken-link" && (s.hotspots || []).some((h) => opensLocalScene(h) && !scenes?.[h.childSceneId])) {
      issues.push({ sceneId: id, level: "error", text: `“${s.title}” has a spot that opens a missing scene.` });
    }
    if (worlds instanceof Map) {
      for (const h of (s.hotspots || []).filter(isWorldDoor)) {
        const world = worlds.get(h.childTopicId);
        if (!world) {
          issues.push({ sceneId: id, level: "warn", text: `A spot in “${s.title}” opens the unknown world “${h.childTopicId}” — children can’t step through.` });
        } else if (world.status && world.status !== "published") {
          issues.push({ sceneId: id, level: "warn", text: `A spot in “${s.title}” opens “${world.title}”, which is still a draft — the door works once that world is published.` });
        }
      }
    }
    if (st.key === "needs-spots") {
      issues.push(isHub
        ? { sceneId: id, level: "error", text: `“${s.title}” has no places pinned yet — pin a place to put something on the globe.` }
        : { sceneId: id, level: "error", text: `“${s.title}” has no spots yet.` });
    }
    if (st.key === "needs-artwork") issues.push({ sceneId: id, level: "warn", text: `“${s.title}” still needs its artwork.` });
    const needsDetails = (s.hotspots || []).filter((h) => spotNeedsDetails(h).needs);
    if (needsDetails.length) {
      issues.push({
        sceneId: id,
        level: "warn",
        text: `“${s.title}” has ${needsDetails.length} ${needsDetails.length === 1 ? "spot" : "spots"} with placeholder details — tap ✦ on ${needsDetails.length === 1 ? "it" : "one of them"} and the agent will write ${needsDetails.length === 1 ? "it" : "them"}.`,
      });
    }
    if (!isHub && (s.hotspots || []).length > 8) {
      issues.push({ sceneId: id, level: "warn", text: `“${s.title}” has more than 8 spots — a crowded picture is hard for children to explore.` });
    }
  }
  return issues;
}

// Spots created with "＋ Add a spot" start as placeholders. A spot "needs
// details" while any card field is empty or still carries that placeholder
// wording — the system auto-writes these with the agent by default.
const PLACEHOLDER_FRAGMENTS = [
  "new spot",
  "a short teaser",
  "new discovery",
  "explain it in one child-friendly paragraph",
  "add a second paragraph if it needs more",
  "one surprising, true fact",
];

const normText = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");

// → { needs: boolean, reason: "empty"|"placeholder"|null }
export function spotNeedsDetails(spot) {
  if (!spot) return { needs: false, reason: null };
  const label = normText(spot.label);
  const blurb = normText(spot.blurb);
  const title = normText(spot.info?.title);
  const body = (spot.info?.body || []).map(normText).filter(Boolean).join(" ");
  const fact = normText(spot.info?.fact);
  if (!label || !blurb || !title || !body) return { needs: true, reason: "empty" };
  const haystack = `${label} ${blurb} ${title} ${body} ${fact}`;
  const hit = PLACEHOLDER_FRAGMENTS.find((p) => haystack.includes(p));
  return hit ? { needs: true, reason: "placeholder" } : { needs: false, reason: null };
}

// Undo for a Topic Builder run: removes exactly the scenes it created AND the
// spots that opened them (unlike deleteSceneFrom, which keeps the spot as a
// fact). Returns a NEW scenes map.
export function undoBuiltScenes(scenes, createdIds) {
  const gone = new Set(createdIds);
  const next = {};
  for (const [sid, s] of Object.entries(scenes || {})) {
    if (gone.has(sid)) continue;
    next[sid] = { ...s, hotspots: (s.hotspots || []).filter((h) => !(opensLocalScene(h) && gone.has(h.childSceneId))) };
  }
  return next;
}

// Shelf summaries for the developer-authored (bundled) packs so the Studio
// lists every world in one place. Bundled entries are flagged `bundled: true`
// until the first save creates a studio override. Preserve the complete pack.
export function bundledTopicSummaries(packs) {
  return (packs || []).map((p) => ({
    ...p,
    id: p.id,
    title: p.title,
    tagline: p.tagline || "",
    emoji: p.emoji || "🌟",
    scenes: p.scenes || {},
    rootSceneId: p.rootSceneId,
    discoveryCount: Object.values(p.scenes || {}).reduce((n, s) => n + (s.hotspots?.length || 0), 0),
    status: "bundled",
    bundled: true,
  }));
}
