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
export const addWikidoChildScene = (data) => call("addWikidoChildScene", LONG)(data || {});
export const suggestWikidoScenes = (data) => call("suggestWikidoScenes", { timeout: 120_000 })(data || {});
export const planWikidoOutline = (data) => call("planWikidoOutline", { timeout: 180_000 })(data || {});
export const generateWikidoSceneImage = (data) => call("generateWikidoSceneImage", { timeout: 180_000 })(data || {});
export const generateWikidoImages = (data) => call("generateWikidoImages", LONG)(data || {});

// Curation
export const saveWikidoTopic = (data) => call("saveWikidoTopic")(data || {});
export const setWikidoTopicStatus = (data) => call("setWikidoTopicStatus")(data || {});
export const deleteWikidoTopic = (data) => call("deleteWikidoTopic")(data || {});
export const reorderWikidoTopics = (data) => call("reorderWikidoTopics")(data || {});

// Voiceovers — the local Kokoro bridge synthesizes; this callable uploads the
// MP3 to Storage and wires the pack's audio field (superadmin only).
export const attachWikidoAudio = (data) => call("attachWikidoAudio", { timeout: 120_000 })(data || {});

// Spot details — the agent writes one spot's card (label, teaser, card text,
// fun fact) from the scene/picture context (superadmin only).
export const generateWikidoSpotDetails = (data) => call("generateWikidoSpotDetails", { timeout: 120_000 })(data || {});
// topic-wide depth assessment — read-only; the studio builds what it proposes
export const planWikidoDepth = (data) => call("planWikidoDepth", { timeout: 180_000 })(data || {});

// ── Local voiceover bridge ────────────────────────────────────────────────────
// Kokoro runs on the dev machine (see `npm run wikido:bridge`). The studio
// probes it, sends the exact on-screen text of every clip, and uploads what
// comes back. Fully optional: topics without recordings use runtime TTS.
export const BRIDGE_URL = "http://localhost:8787";

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
