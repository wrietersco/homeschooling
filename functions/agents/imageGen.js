// AI storybook illustrations (spec §41) — generate a gentle children's-book
// image for a reading activity and store it so both parent and child can see it.
//
// Pipeline: Gemini image model (gemini-2.5-flash-image) → PNG bytes → Firebase
// Storage (default bucket) → Firebase download-token URL (public read without
// needing object ACLs / uniform-access tweaks).
//
// Best-effort throughout: any failure returns null and the activity content is
// served without an image. Images are large (~1-2MB) so they are NEVER stored
// in Firestore — only the URL is kept on the content/token.
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";
import { recordCostEvent } from "../lib/costMeter.js";

// Default when no model is passed in (superadmin can override per-agent via the
// Platform → LLM config → Storybook images selector, threaded through `model`).
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

// Google exposes two different image APIs on generativelanguage:
//   • Gemini "image" models (gemini-*-image)  → :generateContent + IMAGE modality
//   • Imagen models (imagen-*)                 → :predict with instances/parameters
// Pick the call shape from the model id so a superadmin can select either family.
function isImagenModel(model) {
  return /^imagen-/i.test(String(model || ""));
}

// Call one image model and return { data: base64, mime } or null on any failure.
async function callImageModel({ model, prompt, apiKey, fetchImpl }) {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  const headers = { "x-goog-api-key": apiKey, "Content-Type": "application/json" };

  if (isImagenModel(model)) {
    const res = await fetchImpl(`${base}:predict`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "1:1", personGeneration: "allow_all" },
      }),
    });
    if (!res.ok) { console.error("imageGen: imagen HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300)); return null; }
    const json = await res.json();
    const pred = (json?.predictions || [])[0];
    if (!pred?.bytesBase64Encoded) { console.error("imageGen: no prediction image in response"); return null; }
    return { data: pred.bytesBase64Encoded, mime: pred.mimeType || "image/png" };
  }

  // Gemini conversational image model (Nano Banana et al.).
  const res = await fetchImpl(`${base}:generateContent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!res.ok) { console.error("imageGen: model HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300)); return null; }
  const json = await res.json();
  const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!part) { console.error("imageGen: no inline image in response"); return null; }
  return { data: part.inlineData.data, mime: part.inlineData.mimeType || "image/png" };
}

// The default Firebase Storage bucket (set in initializeApp). This project's
// locked-down compute service account can only access the default bucket, which
// exists once Firebase Storage is enabled in the console. We serve images via
// Firebase download-token URLs (public read without object-ACL changes).
async function ensureBucket() {
  const bucket = getStorage().bucket();
  const [exists] = await bucket.exists(); // throws/!exists if Storage not enabled
  if (!exists) throw new Error("default Storage bucket does not exist — enable Firebase Storage");
  return bucket;
}

// Build the image prompt for a given style. `scene` is the storybook narrative;
// `object` is a single clear subject for picture-naming / letter-sound cards.
function promptFor(style, subject) {
  if (style === "object") {
    return (
      `A single, clear, friendly children's illustration of: ${subject}. ` +
      `One subject only, centred on a plain soft pastel background, no scenery clutter. ` +
      `Bright flat colours, simple rounded shapes, easy for a young child to recognise and name. ` +
      `Wholesome and modest. No text, no words, no letters in the image.`
    );
  }
  return (
    `A gentle, warm children's storybook illustration of: ${subject}. ` +
    `Soft watercolour style, bright friendly colours, simple shapes, suitable for young children. ` +
    `Wholesome and modest. No text, no words, no letters in the image.`
  );
}

// Generate an illustration. `style` is "scene" (storybook, default) or "object"
// (one clear subject for picture-naming cards). `model` selects the image model
// (defaults to the built-in); the superadmin's per-agent choice flows in here.
// Returns { url, alt } or null.
export async function generateActivityImage({ scene, apiKey, pathHint, style = "scene", model = DEFAULT_IMAGE_MODEL, fetchImpl = globalThis.fetch, meter = null }) {
  if (!apiKey || !scene) return null;

  const imageModel = String(model || "").trim() || DEFAULT_IMAGE_MODEL;
  const prompt = promptFor(style, scene);

  let buffer, mime;
  try {
    const out = await callImageModel({ model: imageModel, prompt, apiKey, fetchImpl });
    if (!out) return null;
    buffer = Buffer.from(out.data, "base64");
    mime = out.mime;
  } catch (e) {
    console.error("imageGen: generation error", e?.message || e);
    return null;
  }

  // The image was billed the moment the API returned it — record cost now, before
  // storage (so a storage failure never loses the cost). Best-effort.
  if (meter?.db && meter.familyId) {
    await recordCostEvent(meter.db, {
      familyId: meter.familyId, kind: "image", agentKey: "image", model: imageModel,
      source: meter.source || "imageGen", usage: { images: 1 },
      uid: meter.uid, activityId: meter.activityId,
    });
  }

  try {
    const bucket = await ensureBucket();
    const ext = mime.includes("jpeg") ? "jpg" : "png";
    const token = randomUUID();
    const filePath = `activity-images/${pathHint}-${token.slice(0, 8)}.${ext}`;
    const file = bucket.file(filePath);
    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType: mime,
        cacheControl: "public, max-age=31536000",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
    return { url, alt: scene.slice(0, 140) };
  } catch (e) {
    console.error("imageGen: storage error", e?.message || e);
    return null; // storage not available — serve content without the image
  }
}

// Generate object illustrations for a list of items, in parallel with a small
// concurrency cap (image latency is high; a pool keeps total time bounded while
// not flooding the model). Each item is { subject, pathHint }. Returns an array
// aligned with `items`, each entry { url, alt } or null. Best-effort throughout.
export async function generateObjectImages(items, { apiKey, model = DEFAULT_IMAGE_MODEL, concurrency = 3, fetchImpl = globalThis.fetch, meter = null } = {}) {
  const results = new Array(items.length).fill(null);
  if (!apiKey || !items.length) return results;

  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const { subject, pathHint } = items[i];
      if (!subject) continue;
      results[i] = await generateActivityImage({ scene: subject, apiKey, pathHint, style: "object", model, fetchImpl, meter });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
