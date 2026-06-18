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

const IMAGE_MODEL = "gemini-2.5-flash-image";

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

// Generate an illustration from a scene description. Returns { url, alt } or null.
export async function generateActivityImage({ scene, apiKey, pathHint, fetchImpl = globalThis.fetch }) {
  if (!apiKey || !scene) return null;

  const prompt =
    `A gentle, warm children's storybook illustration of: ${scene}. ` +
    `Soft watercolour style, bright friendly colours, simple shapes, suitable for young children. ` +
    `Wholesome and modest. No text, no words, no letters in the image.`;

  let buffer, mime;
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      }
    );
    if (!res.ok) { console.error("imageGen: model HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300)); return null; }
    const json = await res.json();
    const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
    if (!part) { console.error("imageGen: no inline image in response"); return null; }
    buffer = Buffer.from(part.inlineData.data, "base64");
    mime = part.inlineData.mimeType || "image/png";
  } catch (e) {
    console.error("imageGen: generation error", e?.message || e);
    return null;
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
