// Wikido Studio callables — superadmin generation + curation of immersive
// picture-encyclopedia topics on ANY subject. Generated topics live in the
// `wikidoTopics` Firestore collection (draft → published); artwork is generated
// with the platform image model and stored in Firebase Storage; spoken audio
// uses the runtime TTS chain (scene.audio may be attached later by the
// developer's Kokoro script exactly as for hand-authored packs).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { resolveLlm } from "./agentConfig.js";
import { DEFAULT_IMAGE_MODEL } from "./imageGen.js";
import {
  buildTopicPrompt,
  buildChildScenePrompt,
  buildSuggestPrompt,
  normalizeSuggestions,
  buildOutlinePrompt,
  normalizeOutline,
  OUTLINE_LIMITS,
  buildSpotDetailsPrompt,
  normalizeSpotDetails,
  normalizeGeneratedPack,
  normalizeForSave,
  validateTopicPack,
  countDiscoveries,
  uniquePackId,
  slugify,
  parseLlmJson,
  buildDepthPrompt,
  normalizeDepthPlan,
} from "../lib/wikidoPack.js";

const COLLECTION = "wikidoTopics";
const IMAGE_MODEL = DEFAULT_IMAGE_MODEL;

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
  return request.auth.uid;
}

function topicsCol() {
  return getFirestore().collection(COLLECTION);
}

// Firestore rejects undefined values — strip them from any write payload.
export function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map((v) => withoutUndefined(v)).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = withoutUndefined(v);
    }
    return out;
  }
  return value;
}

// Image model call pinned to a 16:9 canvas (the platform's storybook helper is
// 1:1 — scenes need widescreen). Same endpoint + retry posture as imageGen.
async function callImageModelWide({ prompt, apiKey, fetchImpl = globalThis.fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    }),
  });
  if (!res.ok) throw new Error(`Image model HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const json = await res.json();
  const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!part) throw new Error("The image model returned no picture (the prompt may have been blocked).");
  return { data: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType || "image/png" };
}

async function uploadSceneImage(topicId, sceneId, buffer, mime) {
  const bucket = getStorage().bucket();
  const ext = String(mime).includes("jpeg") ? "jpg" : "png";
  const token = randomUUID();
  const filePath = `wikido/${topicId}/${sceneId}-${token.slice(0, 8)}.${ext}`;
  await bucket.file(filePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: "public, max-age=86400",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

// ── Generate a whole topic ────────────────────────────────────────────────────
export const generateWikidoTopic = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 240 },
  async (request) => {
    const uid = requireSuperAdmin(request);
    const title = String(request.data?.title || "").trim().slice(0, 80);
    const angle = String(request.data?.angle || "").trim().slice(0, 300);
    if (!title) throw new HttpsError("invalid-argument", "Give the topic a title, e.g. “The Water Cycle”.");
    if (!process.env.GEMINI_API_KEY) {
      throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret to generate topics.");
    }

    const db = getFirestore();
    const { llm, genConfig, provider } = await resolveLlm(db, "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const existing = await topicsCol().select().get();
    const takenIds = existing.docs.map((d) => d.id);

    const result = await llm.generate({
      system: buildTopicPrompt({ title, angle }),
      contents: [{ role: "user", parts: [{ text: `Generate the topic pack JSON for: ${title}${angle ? ` (${angle})` : ""}.` }] }],
      config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 16384) },
    });

    let pack;
    try {
      pack = parseLlmJson(result.text);
    } catch (e) {
      throw new HttpsError("internal", `The model's answer could not be parsed: ${e?.message || e}`);
    }
    const { pack: normalized, fixes } = normalizeGeneratedPack({ ...pack, title: pack.title || title });
    // a fresh topic has no artwork yet — src is filled in by the artwork step
    const errors = validateTopicPack(normalized, { allowMissingArtwork: true });
    if (errors.length) {
      console.error(`[generateWikidoTopic] invalid pack for "${title}":`, errors);
      throw new HttpsError("internal", `The generated topic failed validation: ${errors.slice(0, 5).join(" · ")}`);
    }
    const id = uniquePackId(normalized.id || title, takenIds);
    normalized.id = id;

    const now = Date.now();
    await topicsCol().doc(id).set({
      ...normalized,
      status: "draft",
      origin: "studio",
      discoveryCount: countDiscoveries(normalized),
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    });
    return { id, title: normalized.title, scenes: Object.keys(normalized.scenes).length, discoveries: countDiscoveries(normalized), fixes };
  }
);

// ── Grow a topic: one deeper scene under a parent ────────────────────────────
export const addWikidoChildScene = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 240 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const parentSceneId = slugify(String(request.data?.parentSceneId || ""));
    const label = String(request.data?.label || "").trim().slice(0, 60);
    const focus = String(request.data?.focus || "").trim().slice(0, 300);
    if (!topicId || !parentSceneId) throw new HttpsError("invalid-argument", "Missing topic or parent scene.");

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const parent = pack.scenes?.[parentSceneId];
    if (!parent) throw new HttpsError("invalid-argument", "The parent scene no longer exists.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const db = getFirestore();
    const { llm, genConfig, provider } = await resolveLlm(db, "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const siblingTitles = Object.values(pack.scenes)
      .filter((s) => parent.hotspots.some((h) => h.childSceneId === s.id))
      .map((s) => s.title);

    const result = await llm.generate({
      system: buildChildScenePrompt({ parentScene: parent, siblingTitles, label, focus }),
      contents: [{ role: "user", parts: [{ text: `Design the deeper scene${label ? ` for the doorway "${label}"` : ""}${focus ? ` about ${focus}` : ""}. Output the JSON object only.` }] }],
      config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 8192) },
    });

    let parsed;
    try {
      parsed = parseLlmJson(result.text);
    } catch (e) {
      throw new HttpsError("internal", `The model's answer could not be parsed: ${e?.message || e}`);
    }
    const { pack: childPack, fixes } = normalizeGeneratedPack({
      scenes: { [parsed.scene?.id || parsed.scene?.title || label || "new-scene"]: parsed.scene },
    });
    const child = Object.values(childPack.scenes)[0];
    if (!child) throw new HttpsError("internal", "The model returned no scene content.");
    const childErrors = validateTopicPack(
      { id: "x", title: "x", tagline: "x", rootSceneId: child.id, scenes: { [child.id]: child } },
      { allowMissingArtwork: true }
    ).filter((e) => !e.includes("rootSceneId"));
    if (childErrors.length) {
      throw new HttpsError("internal", `The generated scene was incomplete: ${childErrors.concat(fixes).slice(0, 5).join(" · ")}`);
    }

    // unique scene id within the topic
    let sceneId = child.id;
    let n = 2;
    while (pack.scenes[sceneId]) sceneId = `${child.id}-${n++}`;
    child.id = sceneId;

    const doorway = {
      label: String(parsed.hotspot?.label || label || child.title).slice(0, 60),
      blurb: String(parsed.hotspot?.blurb || `Step inside: ${child.title}`).slice(0, 90),
      x: Number.isFinite(+parsed.hotspot?.x) ? Math.min(96, Math.max(4, +parsed.hotspot.x)) : 50,
      y: Number.isFinite(+parsed.hotspot?.y) ? Math.min(96, Math.max(4, +parsed.hotspot.y)) : 50,
      childSceneId: sceneId,
      info: {
        title: child.title,
        body: [child.narration],
      },
    };

    const scenes = { ...pack.scenes, [sceneId]: child };
    const parentHotspots = (pack.scenes[parentSceneId].hotspots || []).filter((h) => h.childSceneId !== sceneId);
    parentHotspots.push(doorway);
    scenes[parentSceneId] = { ...pack.scenes[parentSceneId], hotspots: parentHotspots };

    await docRef.update({
      scenes,
      discoveryCount: countDiscoveries({ scenes }),
      updatedAt: Date.now(),
    });
    return { sceneId, title: child.title, hotspots: child.hotspots.length };
  }
);

// ── Suggest deeper scenes (read-only) ───────────────────────────────────────
// Returns candidate scenes for the curator to pick from. Nothing is written —
// a click on a suggestion runs addWikidoChildScene, so every existing guard
// (validation, unique ids, draft status) still applies.
export const suggestWikidoScenes = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const parentSceneId = slugify(String(request.data?.parentSceneId || ""));
    if (!topicId || !parentSceneId) throw new HttpsError("invalid-argument", "Missing topic or scene.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const parent = pack.scenes?.[parentSceneId];
    if (!parent) throw new HttpsError("invalid-argument", "That scene no longer exists.");

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const existingTitles = Object.values(pack.scenes).map((s) => s.title);
    const attempt = async () => {
      const result = await llm.generate({
        system: buildSuggestPrompt({ topicTitle: pack.title, parentScene: parent, existingTitles }),
        contents: [{ role: "user", parts: [{ text: "Suggest the deeper scenes now. Output the JSON object only." }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.9, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 2048) },
      });
      return normalizeSuggestions(parseLlmJson(result.text), existingTitles);
    };

    // one retry: a malformed or all-duplicate answer should not surface as an error
    let suggestions = [];
    for (let i = 0; i < 2 && !suggestions.length; i++) {
      try {
        suggestions = await attempt();
      } catch (e) {
        console.warn(`[suggestWikidoScenes] attempt ${i + 1} failed:`, e?.message || e);
      }
    }
    if (!suggestions.length) throw new HttpsError("internal", "The studio could not come up with suggestions this time — try again.");
    return { suggestions };
  }
);

// ── Plan a whole branch (read-only) ─────────────────────────────────────────
// Drafts an outline of new scenes under a parent. NOTHING is written: the
// curator reviews/edits the outline, then the studio builds it scene by scene
// through addWikidoChildScene (so validation + draft status still apply).
export const planWikidoOutline = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 180 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const parentSceneId = slugify(String(request.data?.parentSceneId || ""));
    const total = Math.min(12, Math.max(2, Math.round(Number(request.data?.total) || 6)));
    if (!topicId || !parentSceneId) throw new HttpsError("invalid-argument", "Missing topic or scene.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const parent = pack.scenes?.[parentSceneId];
    if (!parent) throw new HttpsError("invalid-argument", "That scene no longer exists.");

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const existingTitles = Object.values(pack.scenes).map((s) => s.title);
    const attempt = async () => {
      const result = await llm.generate({
        system: buildOutlinePrompt({ topicTitle: pack.title, parentScene: parent, existingTitles, total }),
        contents: [{ role: "user", parts: [{ text: "Plan the branch now. Output the JSON object only." }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 4096) },
      });
      return normalizeOutline(parseLlmJson(result.text), existingTitles, { ...OUTLINE_LIMITS, maxTotal: total });
    };

    let planned = { outline: [], trimmed: false };
    for (let i = 0; i < 2 && !planned.outline.length; i++) {
      try {
        planned = await attempt();
      } catch (e) {
        console.warn(`[planWikidoOutline] attempt ${i + 1} failed:`, e?.message || e);
      }
    }
    if (!planned.outline.length) throw new HttpsError("internal", "The studio could not draft an outline this time — try again.");
    return planned;
  }
);

// ── Artwork ───────────────────────────────────────────────────────────────────
async function generateSceneImageFor(pack, topicId, sceneId) {
  const scene = pack.scenes[sceneId];
  const prompt = [pack.artStyle, scene.artPrompt || scene.image?.alt || scene.title].filter(Boolean).join(" ");
  const { data, mime } = await callImageModelWide({ prompt, apiKey: process.env.GEMINI_API_KEY });
  const url = await uploadSceneImage(topicId, sceneId, data, mime);
  const alt = scene.image?.alt || scene.title;
  await topicsCol().doc(topicId).set(
    { scenes: { [sceneId]: { ...scene, image: { src: url, alt } } }, updatedAt: Date.now() },
    { merge: true }
  );
  return url;
}

export const generateWikidoSceneImage = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 180 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const sceneId = slugify(String(request.data?.sceneId || ""));
    if (!topicId || !sceneId) throw new HttpsError("invalid-argument", "Missing topic or scene.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    if (!pack.scenes?.[sceneId]) throw new HttpsError("invalid-argument", "Unknown scene.");
    try {
      const url = await generateSceneImageFor(pack, topicId, sceneId);
      return { url };
    } catch (e) {
      console.error(`[generateWikidoSceneImage] ${topicId}/${sceneId}:`, e);
      throw new HttpsError("internal", `Artwork generation failed: ${e?.message || e}`);
    }
  }
);

// Generate artwork for every scene of a topic that doesn't have any yet.
export const generateWikidoImages = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const missing = Object.values(pack.scenes)
      .filter((s) => !s.image?.src || !String(s.image.src).startsWith("http"))
      .map((s) => s.id);
    const results = [];
    for (const sceneId of missing) {
      try {
        const url = await generateSceneImageFor(pack, topicId, sceneId);
        pack.scenes[sceneId].image.src = url; // keep local copy fresh for alt lookups
        results.push({ sceneId, ok: true, url });
      } catch (e) {
        results.push({ sceneId, ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    }
    return { generated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
);

// ── Curation ──────────────────────────────────────────────────────────────────
export const saveWikidoTopic = onCall(async (request) => {
  requireSuperAdmin(request);
  const topicId = slugify(String(request.data?.topicId || ""));
  const incoming = request.data?.pack;
  if (!topicId || !incoming) throw new HttpsError("invalid-argument", "Missing topic or content.");
  const docRef = topicsCol().doc(topicId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
  // Normalize first: repairs missing/duplicate hotspot ids from their labels,
  // keeps recorded-audio references, and injects the canonical document id (the
  // studio form deliberately strips `id` — the server owns it). Then validate as
  // a draft (artwork may still be pending; publishing is the strict gate).
  const { pack: normalized, errors } = normalizeForSave(incoming, topicId);
  if (errors.length) {
    throw new HttpsError("invalid-argument", `Fix these before saving: ${errors.slice(0, 5).join(" · ")}`);
  }
  await docRef.set(
    withoutUndefined({ ...normalized, updatedAt: Date.now() }),
    { merge: true }
  );
  return { saved: true, discoveryCount: countDiscoveries(normalized) };
});

export const setWikidoTopicStatus = onCall(async (request) => {
  requireSuperAdmin(request);
  const topicId = slugify(String(request.data?.topicId || ""));
  const status = String(request.data?.status || "");
  if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
  if (!["draft", "published"].includes(status)) throw new HttpsError("invalid-argument", "Status must be draft or published.");
  if (status === "published") {
    // every scene must have real artwork before children can see the topic
    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const errors = validateTopicPack(snap.data());
    if (errors.length) {
      throw new HttpsError("failed-precondition", `Cannot publish yet: ${errors.slice(0, 5).join(" · ")}`);
    }
  }
  await topicsCol().doc(topicId).set({ status, updatedAt: Date.now() }, { merge: true });
  return { status };
});

// Every Storage object a topic owns (scene artwork + recorded audio) lives under
// this prefix. The trailing slash matters: "astronomy" must never match
// "astronomy-pulsars/…".
export function topicStoragePrefix(topicId) {
  const id = slugify(String(topicId || ""));
  return id ? `wikido/${id}/` : "";
}

// Deleting a topic removes its document first (families lose it immediately),
// then its artwork and audio. A Storage failure never undoes the delete — it is
// reported back as `filesFailed` so the leftovers can be cleaned up.
export const deleteWikidoTopic = onCall(async (request) => {
  requireSuperAdmin(request);
  const topicId = slugify(String(request.data?.topicId || ""));
  if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
  await topicsCol().doc(topicId).delete();

  const prefix = topicStoragePrefix(topicId);
  let filesDeleted = 0;
  let filesFailed = false;
  try {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    const results = await Promise.allSettled(files.map((f) => f.delete()));
    filesDeleted = results.filter((r) => r.status === "fulfilled").length;
    filesFailed = results.some((r) => r.status === "rejected");
  } catch (e) {
    console.error(`[deleteWikidoTopic] storage cleanup failed for ${topicId}:`, e);
    filesFailed = true;
  }
  return { deleted: true, filesDeleted, filesFailed };
});

// Shelf order for studio topics — the index each topic gets on the child-facing
// shelf. Bundled developer packs always appear first; studio topics follow in
// this order (unordered topics fall back to the end, alphabetically).
export const reorderWikidoTopics = onCall(async (request) => {
  requireSuperAdmin(request);
  const orderedIds = Array.isArray(request.data?.orderedIds)
    ? request.data.orderedIds.map((id) => slugify(String(id)))
    : [];
  if (!orderedIds.length) throw new HttpsError("invalid-argument", "Missing orderedIds.");
  const batch = getFirestore().batch();
  orderedIds.forEach((id, index) => {
    batch.set(topicsCol().doc(id), { order: index, updatedAt: Date.now() }, { merge: true });
  });
  await batch.commit();
  return { reordered: orderedIds.length };
});

// ── Voiceovers (local Kokoro bridge → Storage) ────────────────────────────────

// Where a clip lives in Storage and which pack field points at it.
export function audioClipPath(topicId, sceneId, hotspotId) {
  const file = hotspotId ? `${sceneId}.${hotspotId}.mp3` : `${sceneId}.mp3`;
  return { filePath: `wikido/${topicId}/audio/${file}`, packField: `audio/${file}` };
}

// Payload guard for clips arriving from the local voiceover bridge.
export function validateAudioPayload(audioBase64, mime) {
  if (typeof audioBase64 !== "string" || !audioBase64) return "Missing audio data.";
  if (mime !== "audio/mpeg") return "Only MP3 (audio/mpeg) clips are accepted.";
  const bytes = Math.ceil(audioBase64.length * 0.75);
  if (bytes > 3 * 1024 * 1024) return "Clip too large (3 MB limit) — check the bridge's bitrate settings.";
  return null;
}

// Attach one recorded MP3 (produced by the local Kokoro bridge) to a scene or
// hotspot: uploads to Storage with a public download token and wires the pack's
// audio field. The explorer's SpeakButton prefers these recordings over TTS.
export const attachWikidoAudio = onCall(
  { secrets: [], timeoutSeconds: 120 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const sceneId = slugify(String(request.data?.sceneId || ""));
    const hotspotId = request.data?.hotspotId ? slugify(String(request.data.hotspotId)) : "";
    if (!topicId || !sceneId) throw new HttpsError("invalid-argument", "Missing topic or scene.");

    const payloadError = validateAudioPayload(request.data?.audioBase64, request.data?.mime);
    if (payloadError) throw new HttpsError("invalid-argument", payloadError);

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const scene = pack.scenes?.[sceneId];
    if (!scene) throw new HttpsError("invalid-argument", "Unknown scene.");
    if (hotspotId && !scene.hotspots?.some((h) => h.id === hotspotId)) {
      throw new HttpsError("invalid-argument", "Unknown hotspot — save your studio edits first, then record again.");
    }

    const buffer = Buffer.from(request.data.audioBase64, "base64");
    const { filePath } = audioClipPath(topicId, sceneId, hotspotId);
    const bucket = getStorage().bucket();
    const token = randomUUID();
    await bucket.file(filePath).save(buffer, {
      resumable: false,
      contentType: "audio/mpeg",
      metadata: {
        cacheControl: "public, max-age=86400",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

    if (hotspotId) {
      const hotspots = scene.hotspots.map((h) => (h.id === hotspotId ? { ...h, audio: url } : h));
      await docRef.update(withoutUndefined({ [`scenes.${sceneId}.hotspots`]: hotspots, updatedAt: Date.now() }));
    } else {
      await docRef.update(withoutUndefined({ [`scenes.${sceneId}.audio`]: url, updatedAt: Date.now() }));
    }
    return { url, path: filePath };
  }
);

// ── Write ONE spot's details by agent ─────────────────────────────────────────
// The studio calls this when a spot has placeholder/empty details (auto after
// "Add a spot", or on demand via ✦). Writes the card a child sees when they tap
// the spot — label, hover teaser, card title, text, fun fact — based on the
// scene and picture context. Position, spot kind, and any doorway are kept.
export const generateWikidoSpotDetails = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const sceneId = slugify(String(request.data?.sceneId || ""));
    const hotspotId = slugify(String(request.data?.hotspotId || ""));
    const hint = String(request.data?.hint || "").trim().slice(0, 300);
    if (!topicId || !sceneId || !hotspotId) throw new HttpsError("invalid-argument", "Missing topic, scene or spot.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const scene = pack.scenes?.[sceneId];
    const spotIndex = (scene?.hotspots || []).findIndex((h) => h.id === hotspotId);
    if (!scene || spotIndex < 0) throw new HttpsError("invalid-argument", "That spot no longer exists.");
    const spot = scene.hotspots[spotIndex];

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const siblingLabels = scene.hotspots.filter((h) => h.id !== hotspotId).map((h) => h.label);
    const childSceneTitle = spot.childSceneId ? pack.scenes[spot.childSceneId]?.title || "" : "";
    const attempt = async () => {
      const result = await llm.generate({
        system: buildSpotDetailsPrompt({
          topicTitle: pack.title, artStyle: pack.artStyle, scene, spot,
          siblingLabels, childSceneTitle: spot.childSceneId ? childSceneTitle : "", hint,
        }),
        contents: [{ role: "user", parts: [{ text: `Write the details for spot ${spotIndex + 1} (“${spot.label}”). Output the JSON object only.` }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.9, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 2048) },
      });
      const { spot: details, errors } = normalizeSpotDetails(parseLlmJson(result.text));
      if (errors.length) throw new Error(errors.join(", "));
      return details;
    };

    // one retry — a malformed answer should degrade to a clear error, not a crash
    let details = null;
    let lastError = null;
    for (let i = 0; i < 2 && !details; i++) {
      try {
        details = await attempt();
      } catch (e) {
        lastError = e;
        console.warn(`[generateWikidoSpotDetails] attempt ${i + 1} failed:`, e?.message || e);
      }
    }
    if (!details) throw new HttpsError("internal", `The agent could not write this spot's details: ${lastError?.message || "unknown error"}`);

    const hotspots = scene.hotspots.map((h) => (h.id === hotspotId ? withoutUndefined({ ...h, ...details }) : h));
    await docRef.update(withoutUndefined({ [`scenes.${sceneId}.hotspots`]: hotspots, updatedAt: Date.now() }));
    return { spot: hotspots[spotIndex] };
  }
);

// ── Add more depth (one click, topic-wide) ────────────────────────────────────
// Read-only assessment: the agent reads the WHOLE topic and proposes the most
// valuable new deeper scenes (parents chosen from the existing map). The studio
// then builds each proposed branch through addWikidoChildScene, so everything
// lands validated as draft edits the curator can undo.
export const planWikidoDepth = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 180 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const maxScenes = Math.min(6, Math.max(1, Math.round(Number(request.data?.maxScenes) || 3)));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const attempt = async () => {
      const result = await llm.generate({
        system: buildDepthPrompt({ pack, maxScenes }),
        contents: [{ role: "user", parts: [{ text: `Assess the topic and propose up to ${maxScenes} new deeper scenes now. Output the JSON object only.` }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 4096) },
      });
      return normalizeDepthPlan(parseLlmJson(result.text), pack, maxScenes);
    };

    let planned = { branches: [], skipped: 0 };
    for (let i = 0; i < 2 && !planned.branches.length; i++) {
      try {
        planned = await attempt();
      } catch (e) {
        console.warn(`[planWikidoDepth] attempt ${i + 1} failed:`, e?.message || e);
      }
    }
    if (!planned.branches.length) {
      throw new HttpsError("internal", "The curator could not find a valuable place to deepen this topic right now — try again later.");
    }
    return {
      branches: planned.branches.map((b) => ({
        parentSceneId: b.parentSceneId,
        parentTitle: pack.scenes[b.parentSceneId].title,
        outline: b.outline,
      })),
      sceneCount: Object.keys(pack.scenes).length,
    };
  }
);
