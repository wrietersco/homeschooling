// Wikido Studio — superadmin-side access to the topic generation + curation
// callables and the raw topic docs. Explorers never use this file; they read
// published topics through services/wikido.js.
import { httpsCallable } from "firebase/functions";
import { collection, getDocs } from "firebase/firestore";
import { functions, db } from "@/lib/firebase";

const call = (name, options) => (data) => httpsCallable(functions, name, options)(data).then((r) => r.data);

// Generation & growth — artwork and multi-scene generation run long server-side
// (the JS SDK's default callable timeout is 70s, far too short here).
const LONG = { timeout: 480_000 };
export const generateWikidoTopic = (data) => call("generateWikidoTopic", LONG)(data || {});
// Globe worlds: create the 3D-Earth shell, then pin places one scene at a time
// by name ("Pakistan", "Lahore") — the agent resolves the place, writes the
// scene, and adds the hub spot at its coordinates.
export const createWikidoGlobeTopic = (data) => call("createWikidoGlobeTopic", { timeout: 120_000 })(data || {});
export const generateWikidoGlobeScene = (data) => call("generateWikidoGlobeScene", LONG)(data || {});
export const addWikidoChildScene = (data) => call("addWikidoChildScene", LONG)(data || {});
export const suggestWikidoScenes = (data) => call("suggestWikidoScenes", { timeout: 120_000 })(data || {});
export const planWikidoOutline = (data) => call("planWikidoOutline", { timeout: 180_000 })(data || {});
export const generateWikidoSceneImage = (data) => call("generateWikidoSceneImage", { timeout: 180_000 })(data || {});
export const generateWikidoImages = (data) => call("generateWikidoImages", LONG)(data || {});
// Spot placement — the agent re-reads the finished picture and moves every
// spot onto what it actually shows (the same pass that runs after artwork
// generation, offered on demand).
export const adjustWikidoSpots = (data) => call("adjustWikidoSpots", { timeout: 120_000 })(data || {});
// Spot placement, topic-wide — every scene with generated artwork is re-placed
// in one run (long: one vision call per scene).
export const adjustWikidoAllSpots = (data) => call("adjustWikidoAllSpots", LONG)(data || {});

// Curation
export const saveWikidoTopic = (data) => call("saveWikidoTopic")(data || {});
export const setWikidoTopicStatus = (data) => call("setWikidoTopicStatus")(data || {});
export const deleteWikidoTopic = (data) => call("deleteWikidoTopic")(data || {});
export const reorderWikidoTopics = (data) => call("reorderWikidoTopics")(data || {});

// Voiceovers — the local Kokoro bridge synthesizes; this callable uploads the
// MP3 to Storage and wires the pack's audio field (superadmin only).
export const attachWikidoAudio = (data) => call("attachWikidoAudio", { timeout: 120_000 })(data || {});

// Paid-premium voiceovers — the platform's own speech model records clips
// server-side (Storage + pack audio fields), no local bridge needed. The studio
// sends clip ids in small chunks; the saved pack is what gets spoken.
export const generateWikidoAudios = (data) => call("generateWikidoAudios", { timeout: 300_000 })(data || {});

// Free-premium voiceovers, synchronous — the same server Kokoro as the queue
// below, but the studio waits per chunk. Used for SCOPED runs (one scene, one
// spot): small enough to hold the connection, and results land immediately.
export const generateWikidoKokoroAudios = (data) => call("generateWikidoKokoroAudios", { timeout: 300_000 })(data || {});

// Free-premium voiceovers — the same Kokoro-82M voice the local bridge uses,
// running on the platform's servers (model bundled in the function; no API key,
// nothing billed per clip). The studio ENQUEUES a job and can close the tab: a
// scheduled worker records clip by clip, and progress is polled from the job.
export const requestWikidoKokoroJob = (data) => call("requestWikidoKokoroJob", { timeout: 200_000 })(data || {});
export const stopWikidoKokoroJob = (data) => call("stopWikidoKokoroJob", { timeout: 30_000 })(data || {});
export const getWikidoKokoroJob = (data) => call("getWikidoKokoroJob", { timeout: 30_000 })(data || {});

// Spot details — the agent writes one spot's card (label, teaser, card text,
// fun fact) from the scene/picture context (superadmin only).
export const generateWikidoSpotDetails = (data) => call("generateWikidoSpotDetails", { timeout: 120_000 })(data || {});
// topic-wide depth assessment — read-only; the studio builds what it proposes
export const planWikidoDepth = (data) => call("planWikidoDepth", { timeout: 180_000 })(data || {});
// re-link assessment — the curator proposes where every unreachable/misplaced
// scene belongs; read-only, the studio applies the moves through its map
export const planWikidoRelinks = (data) => call("planWikidoRelinks", { timeout: 180_000 })(data || {});

// ── Local voiceover bridge ────────────────────────────────────────────────────
// Kokoro runs on the dev machine (see `npm run wikido:bridge`). The studio
// probes it, sends the exact on-screen text of every clip, and uploads what
// comes back. Fully optional: topics without recordings use runtime TTS.
export const BRIDGE_URL = "http://localhost:8787";

// ── Bridge launcher (dev server only) ────────────────────────────────────────
// When the studio is served by the Vite dev server, that server hosts a small
// launcher that can spawn the bridge process and report its true state. A page
// on production hosting has no such endpoint — these calls then report
// `supported: false` and the studio says so instead of pretending.
export const startVoiceoverBridge = async () => {
  try {
    const res = await fetch("/__wikido-bridge/start", { method: "POST", signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    return data?.ok ? { supported: true, ...data } : { supported: false, error: data?.error };
  } catch {
    return { supported: false };
  }
};

export const bridgeLauncherStatus = async () => {
  try {
    const res = await fetch("/__wikido-bridge/status", { signal: AbortSignal.timeout(5000) });
    const data = await res.json().catch(() => null);
    return data?.ok ? { supported: true, ...data } : { supported: false };
  } catch {
    return { supported: false };
  }
};

export async function checkVoiceoverBridge(url = BRIDGE_URL) {
  try {
    const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { online: false, url };
    const data = await res.json();
    return { online: data.ok === true, engine: data.engine, voice: data.voice, model: data.model, url };
  } catch {
    return { online: false, url };
  }
}

export async function synthesizeOnBridge(url, items, { voice, speed } = {}) {
  const res = await fetch(`${url}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, voice, speed }),
    signal: AbortSignal.timeout(480_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Bridge HTTP ${res.status}`);
  }
  return res.json();
}

// The exact clip list the studio will record, mirroring what the UI speaks:
// narration = "<title>. <narration>"; cards = title + body[] + "Fun fact! …".
// Clips that already have recordings are skipped unless force=true.
export function planVoiceoverClips(pack, { force = false } = {}) {
  const items = [];
  for (const scene of Object.values(pack?.scenes || {})) {
    if (force || !scene.audio) {
      items.push({ id: scene.id, text: `${scene.title}. ${scene.narration}` });
    }
    for (const h of scene.hotspots || []) {
      if (force || !h.audio) {
        const text = [h.info?.title, ...(h.info?.body || []), h.info?.fact ? `Fun fact! ${h.info.fact}` : ""]
          .filter(Boolean)
          .join(" ");
        items.push({ id: `${scene.id}.${h.id}`, text });
      }
    }
  }
  return items;
}

// Narrow a full clip plan to ONE scene (its narration + every spot on it) or
// ONE spot. An unknown scope plans to an empty list — the caller reports that.
export function scopeVoiceoverClips(items, { sceneId, hotspotId = "" } = {}) {
  if (!sceneId) return [];
  return (items || []).filter((c) =>
    hotspotId ? c.id === `${sceneId}.${hotspotId}` : c.id === sceneId || c.id.startsWith(`${sceneId}.`)
  );
}

// Raw docs (drafts + published) for the studio workspace. The rules expose
// drafts to superadmins only; the callable side owns every write.
export async function fetchAllWikidoTopicsAdmin() {
  const snap = await getDocs(collection(db, "wikidoTopics"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Shelf order for studio topics: explicit `order` field first, then unordered
// topics alphabetically at the end. Exported pure for tests.
export function sortStudioTopics(topics) {
  return [...topics].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}
