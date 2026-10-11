// Data access for the Wikido encyclopedia. Topics come from two places:
//   • developer-authored packs bundled with the app (the canonical, curated set),
//   • superadmin-generated topics published to the `wikidoTopics` Firestore
//     collection via the Wikido Studio (see functions/agents/wikido.js).
// Both use the same pack shape and the same runtime. This service is the single
// seam the UI talks to.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { wikidoTopicPacks } from "@/lib/wikido";
import { validateTopicPack, normalizePackForLoad } from "@/lib/wikido/schema";

const packCache = new Map();

function packById(topicId) {
  return wikidoTopicPacks.find((p) => p.id === topicId) || null;
}

function summaryFromPack(pack, { source, draft = false } = {}) {
  return {
    id: pack.id,
    title: pack.title,
    tagline: pack.tagline,
    emoji: pack.emoji || "🌟",
    // hand-authored packs use a public/ path; generated ones use their root
    // scene's artwork (the cover doubles as shelf art for both)
    cover: pack.cover || pack.scenes?.[pack.rootSceneId]?.image || null,
    sceneCount: Object.keys(pack.scenes || {}).length,
    discoveryCount: Object.values(pack.scenes || {}).reduce((n, s) => n + (s.hotspots?.length || 0), 0),
    order: Number.isFinite(pack.order) ? pack.order : null,
    source,
    draft,
  };
}

// Shelf summary for the topic picker (no heavy scene data).
export function listWikidoTopics() {
  return wikidoTopicPacks.map((p) => summaryFromPack(p, { source: "bundled" }));
}

// Published topics generated in the Wikido Studio (plus drafts when the caller
// is a superadmin previewing them). Never throws — the bundled shelf must keep
// working when Firestore is unreachable.
export async function fetchCloudTopics({ includeDrafts = false } = {}) {
  try {
    const base = collection(db, "wikidoTopics");
    const snap = includeDrafts
      ? await getDocs(base)
      : await getDocs(query(base, where("status", "==", "published")));
    const topics = [];
    for (const d of snap.docs) {
      // trivially repairable gaps (e.g. a hotspot saved without an id by an
      // older studio save) are healed before strict validation
      const pack = normalizePackForLoad(d.data());
      const errors = validateTopicPack(pack, { allowMissingArtwork: false });
      if (errors.length) {
        console.error(`[wikido] cloud topic "${d.id}" failed validation:\n- ${errors.join("\n- ")}`);
        continue;
      }
      packCache.set(d.id, pack);
      topics.push(summaryFromPack(pack, { source: "cloud", draft: pack.status === "draft" }));
    }
    return topics;
  } catch (e) {
    console.error("[wikido] cloud topics unavailable:", e?.message || e);
    return [];
  }
}

// Full validated pack, or null when the topic doesn't exist / failed validation.
// Invalid packs are logged loudly (console.error) because they mean a developer
// published broken content, but the app must not crash a child's screen.
export function getWikidoTopic(topicId) {
  if (packCache.has(topicId)) return packCache.get(topicId);
  const pack = packById(topicId);
  if (!pack) return null;
  const errors = validateTopicPack(pack);
  if (errors.length) {
    console.error(`[wikido] topic "${topicId}" failed schema validation:\n- ${errors.join("\n- ")}`);
    packCache.set(topicId, null);
    return null;
  }
  packCache.set(topicId, pack);
  return pack;
}

// Async load for the explorer: bundled packs resolve synchronously; studio
// topics are fetched from Firestore (published, or drafts for superadmins —
// the rules enforce that, and validation re-runs on whatever arrives).
export async function loadWikidoTopic(topicId) {
  const bundled = getWikidoTopic(topicId);
  if (bundled) return bundled;
  if (packCache.has(topicId)) return packCache.get(topicId);
  try {
    const snap = await getDoc(doc(db, "wikidoTopics", topicId));
    if (!snap.exists()) return null;
    const pack = normalizePackForLoad(snap.data());
    const errors = validateTopicPack(pack);
    if (errors.length) {
      console.error(`[wikido] cloud topic "${topicId}" failed validation:\n- ${errors.join("\n- ")}`);
      packCache.set(topicId, null);
      return null;
    }
    packCache.set(topicId, pack);
    return pack;
  } catch (e) {
    console.error(`[wikido] topic "${topicId}" could not be loaded:`, e?.message || e);
    return null;
  }
}
