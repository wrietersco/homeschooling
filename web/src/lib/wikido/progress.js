// Wikido discovery progress — which scenes/hotspots a child has explored — is
// lightweight, device-local, and NOT family-scoped curriculum data, so it lives
// in localStorage rather than Firestore. It is a curiosity nudge ("what haven't
// I opened yet?"), never a graded record.
//
// Reads go straight to localStorage on every call (not a module-level cache) so
// writes from other tabs are picked up and tests start clean.
const KEY = "wikido.progress.v1";

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function persistAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode / quota — progress is best-effort */
  }
}

export function useWikidoProgress() {
  function bucket(topicId) {
    const b = readAll()[topicId];
    return b && typeof b === "object" ? b : {};
  }

  function seen(topicId, key) {
    return Boolean(bucket(topicId)[key]);
  }

  function markSeen(topicId, key) {
    const all = readAll();
    if (!all[topicId] || typeof all[topicId] !== "object") all[topicId] = {};
    if (all[topicId][key]) return;
    all[topicId][key] = Date.now();
    persistAll(all);
  }

  function countSeen(topicId) {
    // scene visits are tracked (for seen badges) but don't count toward the
    // "X of Y discovered" figure — that's hotspot discoveries only
    return Object.keys(bucket(topicId)).filter((k) => k.startsWith("hotspot:")).length;
  }

  return { seen, markSeen, countSeen };
}
