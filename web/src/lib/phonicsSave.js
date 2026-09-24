// Save state for the Phonics Playground canvas, so a child who leaves mid-game
// finds their blocks exactly where they left them. Stored per signed-in user
// in localStorage (a shared family tablet keeps each child's canvas separate).
import { SOUND_BY_ID } from "@/lib/phonicsData";

const VERSION = 1;
const KEY_PREFIX = "phonics-canvas:";

export const saveKey = (uid) => KEY_PREFIX + (uid || "anon");

const num = (v) => (Number.isFinite(v) ? v : null);

// Snapshot → plain JSON-able object. Only the durable state is kept; transient
// UI (drag, confetti, banners) is never saved.
export function serializeCanvas({ groups, wordsBuilt, pan, activeRowKey }) {
  return {
    v: VERSION,
    groups: groups.map((g) => ({ key: g.key, x: g.x, y: g.y, soundIds: [...g.soundIds] })),
    wordsBuilt,
    pan: { x: pan.x, y: pan.y },
    activeRowKey,
  };
}

// Parsed data → a safe canvas state, or null when nothing usable is stored.
// Rows with unknown sounds or bad coordinates are dropped rather than crashing
// the game, since storage can hold data from an older build.
export function restoreCanvas(data) {
  if (!data || typeof data !== "object" || data.v !== VERSION || !Array.isArray(data.groups)) return null;
  const seen = new Set();
  const groups = [];
  for (const g of data.groups) {
    if (!g || !Array.isArray(g.soundIds)) continue;
    const key = num(g.key);
    const x = num(g.x);
    const y = num(g.y);
    if (key === null || x === null || y === null || seen.has(key)) continue;
    const soundIds = g.soundIds.filter((id) => typeof id === "string" && Object.hasOwn(SOUND_BY_ID, id));
    if (!soundIds.length) continue;
    seen.add(key);
    groups.push({ key, x, y, soundIds });
  }
  const wordsBuilt = Number.isInteger(data.wordsBuilt) && data.wordsBuilt > 0 ? data.wordsBuilt : 0;
  const pan = { x: num(data.pan?.x) ?? 0, y: num(data.pan?.y) ?? 0 };
  const activeRowKey = seen.has(data.activeRowKey) ? data.activeRowKey : null;
  const groupSeq = groups.reduce((m, g) => Math.max(m, g.key), 0);
  return { groups, wordsBuilt, pan, activeRowKey, groupSeq };
}

export function loadCanvas(uid, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(saveKey(uid));
    return raw ? restoreCanvas(JSON.parse(raw)) : null;
  } catch {
    return null; // private mode / corrupt JSON — start fresh
  }
}

export function saveCanvas(uid, state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(saveKey(uid), JSON.stringify(serializeCanvas(state)));
  } catch {
    /* private mode / quota — the game still works, it just won't persist */
  }
}
