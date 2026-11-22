// Pure helpers for the "Map of scenes" power controls: collapse / expand,
// search, status filters and keyboard moves. No Vue, no storage of its own —
// unit-tested.
//
// `rows` is buildSceneTree() output: depth-first [{ id, depth, parentId }].

export const STATUS_FILTERS = [
  { key: "ready", label: "Ready", dot: "ready" },
  { key: "needs-artwork", label: "Needs artwork", dot: "needs-artwork" },
  { key: "needs-spots", label: "Needs attention", dot: "needs-spots" }, // also covers broken links
];

// "broken-link" is shown with the red dot, so it filters under "needs attention".
export const filterKeyOf = (statusKey) => (statusKey === "broken-link" ? "needs-spots" : statusKey);

// Direct-child and total-descendant counts per scene (rows are depth-first).
export function childCounts(rows) {
  const direct = new Map();
  const total = new Map();
  rows.forEach((r, i) => {
    let n = 0;
    for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j += 1) n += 1;
    total.set(r.id, n);
    direct.set(r.id, rows.filter((c) => c.parentId === r.id).length);
  });
  return { direct, total };
}

export function ancestorIds(rows, id) {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const out = [];
  const seen = new Set([id]);
  let cur = parentOf.get(id);
  while (cur && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = parentOf.get(cur); }
  return out;
}

// Text a search looks through: the scene's title and its spots' names.
export function searchText(scene) {
  return [scene?.title, ...(scene?.hotspots || []).map((h) => h.label)].filter(Boolean).join(" ").toLowerCase();
}

/**
 * Which rows show.
 *   collapsed   Set of scene ids whose children are hidden
 *   query       search text ("" = none)
 *   statuses    Set of filter keys (empty = all)
 *   scenes      id → scene;   statusOf(id) → status key
 * → { rows, matchIds: Set|null, matchCount, filtering }
 * While filtering, every match and all its ancestors show (collapsing is
 * ignored so a match is never hidden).
 */
export function visibleRows({ rows, collapsed, query = "", statuses, scenes, statusOf }) {
  const q = query.trim().toLowerCase();
  const wanted = statuses && statuses.size ? statuses : null;
  const filtering = Boolean(q || wanted);
  if (!filtering) {
    const out = [];
    let hideBelow = Infinity;
    for (const r of rows) {
      if (r.depth > hideBelow) continue;
      hideBelow = Infinity;
      out.push(r);
      if (collapsed.has(r.id)) hideBelow = r.depth;
    }
    return { rows: out, matchIds: null, matchCount: rows.length, filtering };
  }
  const matchIds = new Set();
  for (const r of rows) {
    if (q && !searchText(scenes[r.id]).includes(q)) continue;
    if (wanted && !wanted.has(filterKeyOf(statusOf(r.id)))) continue;
    matchIds.add(r.id);
  }
  const show = new Set(matchIds);
  for (const id of matchIds) for (const a of ancestorIds(rows, id)) show.add(a);
  return { rows: rows.filter((r) => show.has(r.id)), matchIds, matchCount: matchIds.size, filtering };
}

// Ids of every scene that has children (for "Collapse all").
export const parentIds = (rows) => rows.filter((r, i) => rows[i + 1] && rows[i + 1].depth > r.depth).map((r) => r.id);

// Keyboard: what an arrow key does on the row `id`.
//   → { select?: id, collapse?: id, expand?: id } | null
export function keyAction({ key, id, visible, collapsed, hasChildren }) {
  const i = visible.findIndex((r) => r.id === id);
  if (i < 0) return null;
  if (key === "ArrowDown") return visible[i + 1] ? { select: visible[i + 1].id } : null;
  if (key === "ArrowUp") return visible[i - 1] ? { select: visible[i - 1].id } : null;
  if (key === "ArrowRight") {
    if (hasChildren && collapsed.has(id)) return { expand: id };
    const next = visible[i + 1];
    return next && next.parentId === id ? { select: next.id } : null;
  }
  if (key === "ArrowLeft") {
    if (hasChildren && !collapsed.has(id)) return { collapse: id };
    const parent = visible[i].parentId;
    return parent && visible.some((r) => r.id === parent) ? { select: parent } : null;
  }
  return null;
}

// ── remembered collapsed state, per world ─────────────────────────────────────
const storageKey = (topicId) => "wikido.tree.collapsed." + topicId;
export function loadCollapsed(topicId, storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(storageKey(topicId)) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
export function saveCollapsed(topicId, set, storage = globalThis.localStorage) {
  try {
    storage.setItem(storageKey(topicId), JSON.stringify([...set]));
  } catch {
    /* private mode etc. — remembering is a convenience only */
  }
}
