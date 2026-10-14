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
import { resolveLlm, loadAgentConfig } from "./agentConfig.js";
import { DEFAULT_IMAGE_MODEL } from "./imageGen.js";
import {
  TTS_PROVIDERS,
  resolveTtsSelection,
  ttsPayloadForKind,
  pcmToWav,
  synthesizeSpeakable,
} from "./tts.js";
import { enforcePaidTtsCapacity } from "../platform/quota.js";
import {
  buildChildScenePrompt,
  buildSuggestPrompt,
  normalizeSuggestions,
  buildOutlinePrompt,
  normalizeOutline,
  OUTLINE_LIMITS,
  buildSpotDetailsPrompt,
  buildSpotPlacementPrompt,
  normalizeSpotPlacements,
  normalizePainterSpots,
  mergeSpotPlacements,
  applySpotPlacements,
  normalizeSpotDetails,
  normalizeGeneratedPack,
  normalizeForSave,
  validateTopicPack,
  countDiscoveries,
  uniquePackId,
  slugify,
  parseLlmJson,
  parentSceneOf,
  coherencePrompt,
  composeSceneArtPrompt,
  buildDepthPrompt,
  normalizeDepthPlan,
  buildRelinkPrompt,
  normalizeRelinkPlan,
  buildGlobeTopicPrompt,
  normalizeGlobeTopic,
  buildGlobeScenePrompt,
  buildPlaceResolutionPrompt,
  normalizePlaceResolution,
  buildGlobeHubSpot,
} from "../lib/wikidoPack.js";
import { resolvePlaceQuery, countryById } from "../lib/wikidoGazetteer.js";
import { isGlobePack, isGlobeHub } from "../lib/wikidoGlobe.js";
import { getKokoroEngine } from "../lib/wikidoKokoro.js";

import { generateReviewedTopic } from "../lib/wikidoGeneration.js";
import { validatePackCrossTopicDoorways } from "../lib/wikidoHierarchy.js";
import { repairWikidoEdits } from "../lib/wikidoEdits.js";
import { bundledWikidoWorlds } from "../lib/wikidoBundledWorlds.js";

const COLLECTION = "wikidoTopics";
const IMAGE_MODEL = DEFAULT_IMAGE_MODEL;

export function requireSuperAdmin(request) {
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
// Asks for TEXT alongside the picture: the painter reports where it painted
// each spot (buildSpotArtDirection promises it the JSON contract). Some
// image-model versions accept pictures only — one fallback retry drops the
// text half, and the vision pass then places every spot itself.
export async function callImageModelWide({ prompt, apiKey, reference = null, fetchImpl = globalThis.fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
  const parts = reference
    ? [{ text: prompt }, { inlineData: { mimeType: reference.mime, data: reference.data } }]
    : [{ text: prompt }];
  const call = (modalities) =>
    fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: modalities, imageConfig: { aspectRatio: "16:9" } },
      }),
    });
  let res = await call(["TEXT", "IMAGE"]);
  if (!res.ok && res.status === 400) res = await call(["IMAGE"]);
  if (!res.ok) throw new Error(`Image model HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const json = await res.json();
  const content = json?.candidates?.[0]?.content?.parts || [];
  const part = content.find((p) => p.inlineData);
  if (!part) throw new Error("The image model returned no picture (the prompt may have been blocked).");
  return {
    data: Buffer.from(part.inlineData.data, "base64"),
    mime: part.inlineData.mimeType || "image/png",
    text: content.find((p) => typeof p.text === "string" && p.text)?.text || "",
  };
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

    let normalized, fixes;
    try {
      ({ pack: normalized, fixes } = await generateReviewedTopic({ llm, genConfig, title, angle }));
    } catch (e) {
      throw new HttpsError("internal", e?.message || "Topic generation failed.");
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

// ── Create a GLOBE world (view: "globe") ──────────────────────────────────────
// A globe topic opens on a 3D Earth: the root scene is the hub the globe
// renders, and places are pinned onto it one scene at a time. The model writes
// only the shelf copy + welcome narration; a flaky answer falls back to
// deterministic copy so the world can always be created.
export const createWikidoGlobeTopic = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    const uid = requireSuperAdmin(request);
    const title = String(request.data?.title || "").trim().slice(0, 80);
    const angle = String(request.data?.angle || "").trim().slice(0, 300);
    if (!title) throw new HttpsError("invalid-argument", "Give the globe world a title, e.g. “Our Amazing Earth”.");

    let shell = null;
    if (process.env.GEMINI_API_KEY) {
      try {
        const { llm, genConfig } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
        if (llm) {
          const result = await llm.generate({
            system: buildGlobeTopicPrompt({ title, angle }),
            contents: [{ role: "user", parts: [{ text: `Create the globe world shell for: ${title}. Output the JSON object only.` }] }],
            config: { ...genConfig, temperature: genConfig?.temperature ?? 0.9, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 2048) },
          });
          shell = normalizeGlobeTopic(parseLlmJson(result.text), { title, angle });
        }
      } catch (e) {
        console.warn("[createWikidoGlobeTopic] shell generation failed, using defaults:", e?.message || e);
      }
    }
    shell = shell || normalizeGlobeTopic(null, { title, angle });

    const existing = await topicsCol().select().get();
    const id = uniquePackId(shell.title, existing.docs.map((d) => d.id));
    const hubId = "globe";
    const now = Date.now();
    await topicsCol().doc(id).set(withoutUndefined({
      id,
      title: shell.title,
      tagline: shell.tagline,
      emoji: shell.emoji,
      artStyle: shell.artStyle,
      view: "globe",
      rootSceneId: hubId,
      scenes: {
        [hubId]: {
          id: hubId,
          title: shell.title,
          narration: shell.welcome,
          image: { src: "", alt: shell.title },
          hotspots: [],
        },
      },
      status: "draft",
      origin: "studio",
      discoveryCount: 0,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    }));
    return { id, title: shell.title };
  }
);

// ── Pin a place on the globe: one scene + one hub spot ────────────────────────
// The curator names a place ("Pakistan", "Lahore", "Eiffel Tower"). The system
// resolves WHERE it is (gazetteer first — countries, capitals, major cities;
// the language model for landmarks), writes the scene, and pins a doorway spot
// on the hub at the place's coordinates with a zoom level (country / city /
// location) that decides when the spot appears as the child zooms in.
export const generateWikidoGlobeScene = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 240 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const query = String(request.data?.query || "").trim().slice(0, 80);
    const focus = String(request.data?.focus || "").trim().slice(0, 300);
    if (!topicId || !query) throw new HttpsError("invalid-argument", "Name a place to pin, e.g. “Pakistan” or “Lahore”.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    if (!isGlobePack(pack)) throw new HttpsError("failed-precondition", "“Pin a place” works on globe worlds — this topic is a picture world.");
    const hub = pack.scenes?.[pack.rootSceneId];
    if (!hub) throw new HttpsError("failed-precondition", "This globe world has no hub scene — recreate it.");

    const db = getFirestore();
    const { llm, genConfig, provider } = await resolveLlm(db, "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    // 1) WHERE is this place? The gazetteer answers countries/capitals/cities
    //    deterministically; anything else (landmarks, wonders) goes to the model.
    let place = resolvePlaceQuery(query);
    if (!place) {
      const resolved = await llm.generate({
        system: buildPlaceResolutionPrompt({ query, topicTitle: pack.title }),
        contents: [{ role: "user", parts: [{ text: `Resolve "${query}" now. Output the JSON object only.` }] }],
        config: { ...genConfig, temperature: 0.2, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 1024) },
      });
      const { place: found, errors } = normalizePlaceResolution(parseLlmJson(resolved.text));
      if (!found) throw new HttpsError("invalid-argument", `“${query}” could not be pinned on the globe: ${errors[0]}.`);
      const country = found.countryId ? countryById.get(found.countryId) : null;
      place = {
        kind: found.level,
        level: found.level,
        id: found.countryId || null,
        name: found.name,
        lat: found.lat,
        lng: found.lng,
        note: found.note,
        country: country ? { id: country.id, name: country.name } : found.countryId ? { id: found.countryId, name: found.countryId } : null,
        via: "model",
      };
    }

    // 2) already pinned? One place, one spot.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const already = (hub.hotspots || []).find((h) => norm(h.label) === norm(place.name));
    if (already) {
      throw new HttpsError("failed-precondition", `“${place.name}” is already pinned on this globe (“${already.label}”).`);
    }

    // 3) write the scene
    const existingNames = (hub.hotspots || []).map((h) => h.label);
    let parsed;
    try {
      const result = await llm.generate({
        system: buildGlobeScenePrompt({ topicTitle: pack.title, artStyle: pack.artStyle, place, existingNames }),
        contents: [{ role: "user", parts: [{ text: `Write the scene for "${place.name}" now${focus ? `, focused on: ${focus}` : ""}. Output the JSON object only.` }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.8, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 8192) },
      });
      parsed = parseLlmJson(result.text);
    } catch (e) {
      throw new HttpsError("internal", `The model's answer could not be parsed: ${e?.message || e}`);
    }
    const { pack: childPack, fixes } = normalizeGeneratedPack({
      scenes: { [parsed.scene?.id || parsed.scene?.title || place.name]: parsed.scene },
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

    // 4) pin the doorway on the globe hub (unique spot id, creation order =
    //    the sequence children explore in)
    const spot = buildGlobeHubSpot({
      place,
      label: parsed.hotspot?.label || place.name,
      blurb: parsed.hotspot?.blurb || "",
      childSceneId: sceneId,
      info: { title: child.title, body: [child.narration] },
    });
    let m = 2;
    const takenSpotIds = new Set((hub.hotspots || []).map((h) => h.id));
    while (takenSpotIds.has(spot.id)) spot.id = `${spot.id}-${m++}`;

    const hotspots = [...(hub.hotspots || []), spot];
    const scenes = { ...pack.scenes, [sceneId]: child, [pack.rootSceneId]: { ...hub, hotspots } };
    await docRef.update(withoutUndefined({
      scenes,
      discoveryCount: countDiscoveries({ scenes }),
      updatedAt: Date.now(),
    }));
    return {
      sceneId,
      title: child.title,
      spot,
      place: { name: place.name, level: place.level, lat: place.lat, lng: place.lng, via: place.via, country: place.country },
    };
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
    if (isGlobeHub(pack, parentSceneId)) {
      throw new HttpsError(
        "failed-precondition",
        "The globe hub is not a picture — pin a new place on the globe instead (places are added by name)."
      );
    }
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
    // drop stale local spots that still open the new scene id; cross-topic
    // doorways (childTopicId) are never touched — their scene id belongs to
    // another world's namespace
    const parentHotspots = (pack.scenes[parentSceneId].hotspots || []).filter((h) => h.childTopicId || h.childSceneId !== sceneId);
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
// Scene artwork is generated WITH the parent scene's picture as a visual
// reference (when one exists), so deeper layers keep the same style, palette,
// lighting and textures as the world they belong to.
async function generateSceneImageFor(pack, topicId, sceneId) {
  const scene = pack.scenes[sceneId];
  const parent = parentSceneOf(pack.scenes, sceneId);
  const parentArt = String(parent?.image?.src || "");
  // The realism directive rides last: even packs authored before the
  // encyclopedia-realism rule (or edited by hand) render true to life.
  // The scene's spots ride with it: the painter must paint what every spot
  // describes, and report exactly where each landed (see below).
  const prompt = composeSceneArtPrompt({
    artStyle: pack.artStyle,
    artPrompt: scene.artPrompt || scene.image?.alt || scene.title,
    coherence: parentArt.startsWith("http") ? coherencePrompt(parent?.title) : "",
    spots: scene.hotspots,
  });

  let reference = null;
  if (parentArt.startsWith("http")) {
    try {
      const res = await fetch(parentArt);
      if (res.ok) {
        reference = {
          mime: res.headers.get("content-type") || "image/jpeg",
          data: Buffer.from(await res.arrayBuffer()).toString("base64"),
        };
      }
    } catch (e) {
      console.warn(`[wikido] reference fetch failed for ${sceneId}:`, e?.message || e);
    }
  }

  const { data, mime, text } = await callImageModelWide({ prompt, apiKey: process.env.GEMINI_API_KEY, reference });
  const url = await uploadSceneImage(topicId, sceneId, data, mime);
  const alt = scene.image?.alt || scene.title;

  // ── agent-placed spot coordinates ─────────────────────────────────────────
  // The painter reports, as JSON text next to the picture, the precise
  // percentages where it painted every spot — those coordinates move the pins.
  // The vision pass re-reads the finished picture only to fill spots the
  // painter didn't report; the curator fine-tunes by dragging afterwards.
  let placements = normalizePainterSpots(text, scene.hotspots).placements;
  if (placements.length < (scene.hotspots || []).length) {
    const { placements: rest } = await placeSceneSpots(scene, {
      mime,
      data: data.toString("base64"),
      alt,
    });
    placements = mergeSpotPlacements(placements, rest);
  }

  const hotspots = applySpotPlacements(scene.hotspots, placements);
  await topicsCol().doc(topicId).set(
    {
      scenes: { [sceneId]: { ...scene, image: { src: url, alt }, hotspots } },
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  return { url, placements };
}

// ── agent-placed spot coordinates (shared vision pass) ───────────────────────
// A vision call reads a FINISHED picture and returns where every spot belongs,
// in percentages of that exact picture. After artwork generation it only fills
// the spots the painter didn't report; the ✦ Auto-adjust endpoints run it as
// the whole pass against the scene's current picture. Never throws: a failed
// pass returns no placements and the scene keeps its current coordinates.
async function placeSceneSpots(scene, { mime, data, alt }) {
  try {
    const { llm, genConfig } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) return { placements: [], unmatched: [] };
    const vision = await llm.generate({
      system: buildSpotPlacementPrompt({ scene: { ...scene, image: { src: "(attached)", alt: alt || scene.image?.alt || scene.title } } }),
      contents: [{
        role: "user",
        parts: [
          { text: "Place every spot now. Output the JSON object only." },
          { inlineData: { mimeType: mime, data } },
        ],
      }],
      config: { ...genConfig, temperature: genConfig?.temperature ?? 0.2, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 2048) },
    });
    return normalizeSpotPlacements(parseLlmJson(vision.text), scene.hotspots);
  } catch (e) {
    console.warn(`[wikido] spot placement failed for ${scene.id}:`, e?.message || e);
    return { placements: [], unmatched: [] };
  }
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
    if (isGlobeHub(pack, sceneId)) {
      throw new HttpsError("failed-precondition", "The globe hub renders code, not artwork — there is nothing to paint.");
    }
    try {
      const { url, placements } = await generateSceneImageFor(pack, topicId, sceneId);
      return { url, placements };
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
      // a globe hub renders code, not artwork — never paint it
      .filter((s) => !(isGlobePack(pack) && s.id === pack.rootSceneId))
      .filter((s) => !s.image?.src || !/^(https?:\/\/|\/wikido\/)/.test(String(s.image.src)))
      .map((s) => s.id);
    const results = [];
    for (const sceneId of missing) {
      try {
        const { url } = await generateSceneImageFor(pack, topicId, sceneId);
        pack.scenes[sceneId].image.src = url; // keep local copy fresh for alt lookups
        results.push({ sceneId, ok: true, url });
      } catch (e) {
        results.push({ sceneId, ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    }
    return { generated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
);

// ── Auto-adjust spots ──────────────────────────────────────────────────────────
// The same vision pass that places spots right after artwork generation, on
// demand: it re-reads the scene's CURRENT picture and moves every spot onto
// what the picture actually shows. Useful after the curator dragged pins around
// or a picture was painted before the placement pass existed. Writes the moved
// spots through and returns them so the studio shows exactly what moved.
export const adjustWikidoSpots = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    const sceneId = slugify(String(request.data?.sceneId || ""));
    if (!topicId || !sceneId) throw new HttpsError("invalid-argument", "Missing topic or scene.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();
    const scene = pack.scenes?.[sceneId];
    if (!scene) throw new HttpsError("invalid-argument", "Unknown scene.");
    if (!(scene.hotspots || []).length) throw new HttpsError("failed-precondition", "This scene has no spots to place yet — add them first.");
    const src = String(scene.image?.src || "");
    if (!/^https?:\/\//.test(src)) {
      throw new HttpsError("failed-precondition", "Generate this scene's artwork first — auto-adjust reads the finished picture.");
    }

    let image = null;
    try {
      const res = await fetch(src);
      if (res.ok) {
        image = {
          mime: res.headers.get("content-type") || "image/jpeg",
          data: Buffer.from(await res.arrayBuffer()).toString("base64"),
        };
      }
    } catch (e) {
      console.warn(`[adjustWikidoSpots] image fetch failed for ${topicId}/${sceneId}:`, e?.message || e);
    }
    if (!image) throw new HttpsError("internal", "Could not load this scene's picture — try again.");

    const { placements } = await placeSceneSpots(scene, image);
    if (placements.length) {
      await docRef.set(
        {
          scenes: { [sceneId]: { hotspots: applySpotPlacements(scene.hotspots, placements) } },
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    }
    return { placements, placed: placements.length, total: (scene.hotspots || []).length };
  }
);

// ── Auto-adjust every spot in the topic ────────────────────────────────────────
// The per-scene placement pass, run across the whole topic: every scene with
// generated (hosted) artwork gets its spots re-read and re-placed in one run.
// Scenes are persisted one by one, so a timeout or failure keeps the progress
// made so far. Scenes without generated artwork (bundled, hand-authored, or
// still unpainted) are skipped — the pass needs a generated picture to read.
export const adjustWikidoAllSpots = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const results = [];
    let adjusted = 0;
    let failed = 0;
    let skipped = 0;
    for (const scene of Object.values(pack.scenes)) {
      const src = String(scene.image?.src || "");
      if (!/^https?:\/\//.test(src) || !(scene.hotspots || []).length) { skipped += 1; continue; }
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`picture HTTP ${res.status}`);
        const image = {
          mime: res.headers.get("content-type") || "image/jpeg",
          data: Buffer.from(await res.arrayBuffer()).toString("base64"),
        };
        const { placements } = await placeSceneSpots(scene, image);
        if (placements.length) {
          await topicsCol().doc(topicId).set(
            {
              scenes: { [scene.id]: { hotspots: applySpotPlacements(scene.hotspots, placements) } },
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }
        results.push({ sceneId: scene.id, title: scene.title, placed: placements.length, total: scene.hotspots.length });
        adjusted += 1;
      } catch (e) {
        console.warn(`[adjustWikidoAllSpots] ${topicId}/${scene.id}:`, e?.message || e);
        results.push({ sceneId: scene.id, title: scene.title, placed: 0, total: (scene.hotspots || []).length, error: String(e?.message || e).slice(0, 200) });
        failed += 1;
      }
    }
    return { results, adjusted, failed, skipped };
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
  const creatingBundle = !snap.exists && bundledWikidoWorlds.some((world) => world.id === topicId);
  if (!snap.exists && !creatingBundle) throw new HttpsError("not-found", "That topic no longer exists.");

  // Normalize first: repairs missing/duplicate hotspot ids from their labels,
  // keeps recorded-audio references, and injects the canonical document id (the
  // studio form deliberately strips `id` — the server owns it). Then validate as
  // a draft (artwork may still be pending; publishing is the strict gate).
  const repair = repairWikidoEdits({ ...incoming, id: topicId }, [...bundledWikidoWorlds, ...(await topicsCol().get()).docs.map(d => ({ ...d.data(), id: d.id }))]);
  const { pack: normalized, errors } = normalizeForSave(repair.pack, topicId);
  if (errors.length) {
    throw new HttpsError("invalid-argument", `Fix these before saving: ${errors.slice(0, 5).join(" · ")}`);
  }
  if (creatingBundle) normalized.status = "draft"; // Publishing uses the normal strict gate.
  if (repair.repairs.length) {
    await docRef.collection("editBackups").add(withoutUndefined({ pack: incoming, repairs: repair.repairs, createdAt: Date.now() }));
  }
  // Replace the complete scene map: recursive merge resurrects deleted scenes.
  await docRef.set(withoutUndefined({ ...(snap.exists ? snap.data() : {}), ...normalized, updatedAt: Date.now() }));
  return { saved: true, discoveryCount: countDiscoveries(normalized), repairs: repair.repairs };
});

export const setWikidoTopicStatus = onCall(async (request) => {
  requireSuperAdmin(request);
  const topicId = slugify(String(request.data?.topicId || ""));
  const status = String(request.data?.status || "");
  if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
  if (!["draft", "published"].includes(status)) throw new HttpsError("invalid-argument", "Status must be draft or published.");
  const docRef = topicsCol().doc(topicId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
  const pack = snap.data();
  const nextDoc = { ...pack, status, updatedAt: Date.now() };
  let repairs = [];
  if (status === "published") {
    // Publishing is the strict gate — but the system repairs what is trivially
    // repairable first (missing hotspot ids from older builds, etc.), persists
    // the repaired pack, and blocks only on what genuinely cannot ship.
    const repair = repairWikidoEdits({ ...pack, id: topicId }, [...bundledWikidoWorlds, ...(await topicsCol().get()).docs.map(d => ({ ...d.data(), id: d.id }))]);
    repairs = repair.repairs;
    const { pack: normalized } = normalizeForSave(repair.pack, topicId);
    if (repair.repairs.length) await docRef.collection("editBackups").add(withoutUndefined({ pack, repairs: repair.repairs, createdAt: Date.now() }));
    nextDoc.id = topicId;
    nextDoc.discoveryCount = countDiscoveries(normalized);
    nextDoc.scenes = normalized.scenes;
    nextDoc.rootSceneId = normalized.rootSceneId;
    nextDoc.title = normalized.title || nextDoc.title;
    nextDoc.tagline = normalized.tagline || nextDoc.tagline;
    nextDoc.emoji = normalized.emoji || nextDoc.emoji;
    nextDoc.artStyle = normalized.artStyle || nextDoc.artStyle;
    const strictErrors = validateTopicPack(nextDoc);
    if (strictErrors.length) {
      throw new HttpsError("failed-precondition", `Cannot publish yet: ${strictErrors.slice(0, 5).join(" · ")}`);
    }
    // Cross-topic doorways must point at real scenes in real worlds: every
    // other studio topic + the bundled packs. A dangling door would ship a
    // hotspot children can never step through. (Doors into still-draft worlds
    // are fine — they work the moment that world publishes.)
    const knownWorlds = [
      ...bundledWikidoWorlds,
      ...(await topicsCol().get()).docs.filter((d) => d.id !== topicId).map((d) => d.data()),
    ];
    const worldErrors = validatePackCrossTopicDoorways(nextDoc, knownWorlds);
    if (worldErrors.length) {
      throw new HttpsError("failed-precondition", `Cannot publish yet: ${worldErrors.slice(0, 5).join(" · ")}`);
    }
  }
  await docRef.set(withoutUndefined(nextDoc));
  return { status, repairs };
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

// Where a clip lives in Storage and which pack field points at it. The local
// Kokoro bridge writes MP3; the paid-premium server path writes WAV.
export function audioClipPath(topicId, sceneId, hotspotId, ext = "mp3") {
  const file = hotspotId ? `${sceneId}.${hotspotId}.${ext}` : `${sceneId}.${ext}`;
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

// ── Premium voiceovers (paid, server-side) ────────────────────────────────────
// The counterpart to the local Kokoro bridge: records scene/spot clips with the
// platform's configured speech model (AI configuration → tts) straight into
// Storage and wires the pack's audio field — superadmin can voice a whole topic
// from any machine, no local bridge needed. The SAVED pack is the text source
// of truth, so the voice always says exactly what children read.

// The exact text one clip speaks — mirrors the studio's planVoiceoverClips
// (narration = "<title>. <narration>"; cards = title + body[] + "Fun fact! …").
export function wikidoClipText(scene, hotspotId) {
  if (!hotspotId) return `${scene?.title || ""}. ${scene?.narration || ""}`.trim();
  const spot = (scene?.hotspots || []).find((h) => h.id === hotspotId);
  if (!spot) return "";
  return [spot.info?.title, ...(spot.info?.body || []), spot.info?.fact ? `Fun fact! ${spot.info.fact}` : ""]
    .filter(Boolean)
    .join(" ");
}

// Resolve requested clip ids ("sceneId" / "sceneId.hotspotId") against the
// saved pack: unknown ids are dropped and already-recorded clips are skipped
// unless force — a paid re-run never re-bills silence. Pure + unit-tested.
export function pickWikidoAudioClips(pack, clipIds, { force = false } = {}) {
  const picks = [];
  for (const raw of Array.isArray(clipIds) ? clipIds.slice(0, 12) : []) {
    const id = String(raw || "");
    const dot = id.indexOf(".");
    const sceneId = slugify(dot < 0 ? id : id.slice(0, dot));
    const hotspotId = dot < 0 ? "" : slugify(id.slice(dot + 1));
    const scene = pack?.scenes?.[sceneId];
    if (!scene) continue;
    if (hotspotId && !scene.hotspots?.some((h) => h.id === hotspotId)) continue;
    const recorded = hotspotId ? scene.hotspots.find((h) => h.id === hotspotId).audio : scene.audio;
    if (recorded && !force) continue;
    const text = wikidoClipText(scene, hotspotId);
    if (!text) continue;
    picks.push({ id, sceneId, hotspotId, text });
  }
  return picks;
}

// Upload one finished clip and wire its pack field — shared by the paid
// (Gemini/OpenAI) path, the free Kokoro path, and the Kokoro queue worker, so
// every engine writes identically.
export async function uploadClip(bucket, topicId, clip, buffer, ext, mime) {
  const { filePath } = audioClipPath(topicId, clip.sceneId, clip.hotspotId, ext);
  const token = randomUUID();
  await bucket.file(filePath).save(buffer, {
    resumable: false,
    contentType: mime,
    metadata: {
      cacheControl: "public, max-age=86400",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

export async function wireClipAudio(docRef, pack, clip, url) {
  const scene = pack.scenes[clip.sceneId];
  if (clip.hotspotId) {
    const hotspots = scene.hotspots.map((h) => (h.id === clip.hotspotId ? { ...h, audio: url } : h));
    scene.hotspots = hotspots;
    await docRef.update(withoutUndefined({ [`scenes.${clip.sceneId}.hotspots`]: hotspots, updatedAt: Date.now() }));
  } else {
    scene.audio = url;
    await docRef.update(withoutUndefined({ [`scenes.${clip.sceneId}.audio`]: url, updatedAt: Date.now() }));
  }
}

export const generateWikidoAudios = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"], timeoutSeconds: 240 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    const force = Boolean(request.data?.force);
    const clipIds = Array.isArray(request.data?.clipIds) ? request.data.clipIds : [];
    if (!clipIds.length) throw new HttpsError("invalid-argument", "Missing clipIds.");

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const clips = pickWikidoAudioClips(pack, clipIds, { force });
    if (!clips.length) {
      throw new HttpsError("failed-precondition", "Nothing to record — every requested clip already has audio (or no longer exists). Save your studio edits first, then generate again.");
    }

    const db = getFirestore();
    const cfg = await loadAgentConfig(db, "tts");
    const isAvailable = (pv) => Boolean(TTS_PROVIDERS[pv] && process.env[TTS_PROVIDERS[pv].secret]);
    const { provider, model, voiceName } = resolveTtsSelection({ config: cfg, isAvailable });
    const { synth, secret } = TTS_PROVIDERS[provider];
    const apiKey = process.env[secret];
    if (!apiKey) {
      throw new HttpsError("failed-precondition", `The ${provider} speech provider has no API key set — add it (or switch the speech provider in AI configuration) to generate audios.`);
    }

    const bucket = getStorage().bucket();
    const results = [];
    let stoppedEarly = false;
    for (const clip of clips) {
      try {
        // the shared speech pool the whole platform draws from — same guard as
        // click-to-hear; a dry pool stops the run rather than half-charging it
        await enforcePaidTtsCapacity(db, model);
        // wikido narration is story-like: the same warm child-facing tone as
        // stories everywhere else on the platform
        const { text: spokenText, instructions } = ttsPayloadForKind(clip.text, "story", provider, model);
        const out = await synthesizeSpeakable(synth, { text: spokenText, voiceName, model, apiKey, instructions });
        const wav = pcmToWav(out.pcm, { sampleRate: out.sampleRate });
        const url = await uploadClip(bucket, topicId, clip, wav, "wav", "audio/wav");
        await wireClipAudio(docRef, pack, clip, url);
        results.push({ id: clip.id, url });
      } catch (e) {
        results.push({ id: clip.id, error: String(e?.message || e).slice(0, 200) });
        if (e instanceof HttpsError && e.code === "resource-exhausted") {
          stoppedEarly = true; // the shared speech pool is dry — stop the run
          break;
        }
      }
    }
    return {
      results,
      recorded: results.filter((r) => r.url).length,
      failed: results.filter((r) => r.error).length,
      stoppedEarly,
    };
  }
);

// ── Premium voiceovers (free Kokoro, on the platform's servers) ───────────────
// The bridge's voice without the bridge: the bundled Kokoro-82M weights run on
// this function (see lib/wikidoKokoro.js) — no API key, nothing billed per
// clip, warm instances reuse the loaded model. Same chunked contract as the
// paid path: the studio sends clip ids, the SAVED pack is the text source of
// truth, and each finished clip is uploaded and wired as it completes.
export const generateWikidoKokoroAudios = onCall(
  { secrets: [], timeoutSeconds: 540, memory: "2GiB", cpu: 2 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    const force = Boolean(request.data?.force);
    const clipIds = Array.isArray(request.data?.clipIds) ? request.data.clipIds : [];
    if (!clipIds.length) throw new HttpsError("invalid-argument", "Missing clipIds.");

    const docRef = topicsCol().doc(topicId);
    const snap = await docRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const clips = pickWikidoAudioClips(pack, clipIds, { force });
    if (!clips.length) {
      throw new HttpsError("failed-precondition", "Nothing to record — every requested clip already has audio (or no longer exists). Save your studio edits first, then generate again.");
    }

    let engine;
    try {
      engine = await getKokoroEngine();
    } catch (e) {
      console.error("[generateWikidoKokoroAudios] model load failed:", e);
      throw new HttpsError("internal", `The Kokoro voice could not load on the server: ${String(e?.message || e).slice(0, 160)}`);
    }

    const bucket = getStorage().bucket();
    const results = [];
    for (const clip of clips) {
      try {
        const { mp3Base64 } = await engine.generate(clip.text);
        const buffer = Buffer.from(mp3Base64, "base64");
        const url = await uploadClip(bucket, topicId, clip, buffer, "mp3", "audio/mpeg");
        await wireClipAudio(docRef, pack, clip, url);
        results.push({ id: clip.id, url });
      } catch (e) {
        console.warn(`[generateWikidoKokoroAudios] ${topicId}/${clip.id}:`, e?.message || e);
        results.push({ id: clip.id, error: String(e?.message || e).slice(0, 200) });
      }
    }
    return {
      results,
      recorded: results.filter((r) => r.url).length,
      failed: results.filter((r) => r.error).length,
    };
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
    // optional curator steering — the direction the new depth should explore
    const hint = String(request.data?.hint || "").trim().slice(0, 300);
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");

    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const attempt = async () => {
      const result = await llm.generate({
        system: buildDepthPrompt({ pack, maxScenes, hint }),
        contents: [{ role: "user", parts: [{ text: `Assess the topic and propose up to ${maxScenes} new deeper scenes now${hint ? ", following the curator's direction" : ""}. Output the JSON object only.` }] }],
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

// ── Re-link misplaced scenes (read-only) ────────────────────────────────────────
// The curator studies the whole topic — titles, narrations, spot labels,
// doorways — and proposes where every unreachable or misplaced scene belongs.
// NOTHING is written: the studio applies the moves through its guarded tree
// helpers, so the change stays a reviewable draft edit until the next save.
export const planWikidoRelinks = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 180 },
  async (request) => {
    requireSuperAdmin(request);
    const topicId = slugify(String(request.data?.topicId || ""));
    if (!topicId) throw new HttpsError("invalid-argument", "Missing topic.");
    if (!process.env.GEMINI_API_KEY) throw new HttpsError("failed-precondition", "Set the GEMINI_API_KEY secret.");
    const snap = await topicsCol().doc(topicId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That topic no longer exists.");
    const pack = snap.data();

    const { llm, genConfig, provider } = await resolveLlm(getFirestore(), "wikido", { gemini: process.env.GEMINI_API_KEY });
    if (!llm) throw new HttpsError("failed-precondition", `The text model provider "${provider}" has no API key set.`);

    const attempt = async () => {
      const result = await llm.generate({
        system: buildRelinkPrompt({ pack }),
        contents: [{ role: "user", parts: [{ text: "Propose the re-linking moves now. Output the JSON object only." }] }],
        config: { ...genConfig, temperature: genConfig?.temperature ?? 0.3, maxOutputTokens: Math.max(genConfig?.maxOutputTokens || 0, 4096) },
      });
      return normalizeRelinkPlan(parseLlmJson(result.text), pack);
    };

    let planned = { moves: [], skipped: 0 };
    for (let i = 0; i < 2 && !planned.moves.length; i++) {
      try {
        planned = await attempt();
      } catch (e) {
        console.warn(`[planWikidoRelinks] attempt ${i + 1} failed:`, e?.message || e);
      }
    }
    return {
      moves: planned.moves.map((m) => ({
        ...m,
        sceneTitle: pack.scenes[m.sceneId].title,
        parentTitle: pack.scenes[m.parentSceneId].title,
      })),
      skipped: planned.skipped,
    };
  }
);
