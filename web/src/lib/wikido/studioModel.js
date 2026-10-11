// Pure view-model helpers for the Wikido Studio. No Vue, no Firebase — so the
// plain-language wording the studio shows (what a spot does, what deleting a
// scene removes, which scenes need attention) is unit-tested.
//
// Vocabulary (one word per idea): a topic is a MAP of SCENES; a scene is a
// picture with SPOTS; a spot either SHOWS A FACT or OPENS another scene.

const hasArtwork = (scene) => String(scene?.image?.src || "").startsWith("http");

// What tapping this spot does, in words a curator can read at a glance.
// → { kind: "fact"|"scene"|"broken", text, targetId|null }
export function spotOutcome(scenes, spot) {
  if (!spot?.childSceneId) return { kind: "fact", text: "Shows a fact card", targetId: null };
  const target = scenes?.[spot.childSceneId];
  if (!target) return { kind: "broken", text: "Opens a scene that no longer exists", targetId: null };
  return { kind: "scene", text: `Opens “${target.title}”`, targetId: target.id };
}

// Ready / needs-attention state shown as a dot next to every scene in the map.
// → { key: "ready"|"needs-artwork"|"needs-spots"|"broken-link", label }
export function sceneStatus(scenes, scene) {
  if (!scene) return { key: "needs-spots", label: "Missing" };
  if ((scene.hotspots || []).some((h) => h.childSceneId && !scenes?.[h.childSceneId])) {
    return { key: "broken-link", label: "A spot opens a missing scene" };
  }
  if (!(scene.hotspots || []).length) return { key: "needs-spots", label: "No spots yet" };
  if (!hasArtwork(scene)) return { key: "needs-artwork", label: "Needs artwork" };
  return { key: "ready", label: "Ready" };
}

// Every scene reachable ONLY through sceneId (the scene itself + its subtree of
// scenes that no spot elsewhere also opens). Deleting a scene removes exactly
// these when the user chooses "delete with deeper scenes".
export function descendantSceneIds(scenes, sceneId) {
  const out = new Set();
  const walk = (id) => {
    if (out.has(id) || !scenes?.[id]) return;
    out.add(id);
    for (const h of scenes[id].hotspots || []) if (h.childSceneId) walk(h.childSceneId);
  };
  walk(sceneId);
  return [...out];
}

// Plain-language consequences of deleting a scene, for the confirm dialog.
// → { deeper: [titles], openedBy: [{ sceneId, spotId, label, sceneTitle }] }
export function deletePlan(scenes, sceneId) {
  const subtree = descendantSceneIds(scenes, sceneId);
  const subtreeSet = new Set(subtree);
  const openedBy = [];
  for (const [sid, s] of Object.entries(scenes || {})) {
    for (const h of s.hotspots || []) {
      if (h.childSceneId === sceneId && !subtreeSet.has(sid)) {
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
        if (!h.childSceneId || !doomed.has(h.childSceneId)) return h;
        const { childSceneId, ...rest } = h; // eslint-disable-line no-unused-vars
        return rest;
      }),
    };
  }
  return next;
}

// Whole-topic checklist shown above the map. Plain sentences, one per problem.
// → [{ sceneId, level: "error"|"warn", text }]
export function topicHealth(scenes, rootSceneId) {
  const issues = [];
  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id) || !scenes?.[id]) return;
    reachable.add(id);
    for (const h of scenes[id].hotspots || []) if (h.childSceneId) walk(h.childSceneId);
  };
  walk(rootSceneId);

  for (const [id, s] of Object.entries(scenes || {})) {
    if (!reachable.has(id)) {
      issues.push({ sceneId: id, level: "error", text: `“${s.title}” isn’t opened by any spot, so children can never reach it.` });
    }
    const st = sceneStatus(scenes, s);
    if (st.key === "broken-link") issues.push({ sceneId: id, level: "error", text: `“${s.title}” has a spot that opens a missing scene.` });
    if (st.key === "needs-spots") issues.push({ sceneId: id, level: "error", text: `“${s.title}” has no spots yet.` });
    if (st.key === "needs-artwork") issues.push({ sceneId: id, level: "warn", text: `“${s.title}” still needs its artwork.` });
    const needsDetails = (s.hotspots || []).filter((h) => spotNeedsDetails(h).needs);
    if (needsDetails.length) {
      issues.push({
        sceneId: id,
        level: "warn",
        text: `“${s.title}” has ${needsDetails.length} ${needsDetails.length === 1 ? "spot" : "spots"} with placeholder details — tap ✦ on ${needsDetails.length === 1 ? "it" : "one of them"} and the agent will write ${needsDetails.length === 1 ? "it" : "them"}.`,
      });
    }
    if ((s.hotspots || []).length > 8) issues.push({ sceneId: id, level: "warn", text: `“${s.title}” has more than 8 spots — a crowded picture is hard for children to explore.` });
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
    next[sid] = { ...s, hotspots: (s.hotspots || []).filter((h) => !(h.childSceneId && gone.has(h.childSceneId))) };
  }
  return next;
}
