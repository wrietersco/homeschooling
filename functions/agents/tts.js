// Text-to-speech via Gemini's TTS model. The frontend calls synthesizeSpeech
// whenever a user taps a word / phrase / paragraph (any language). Gemini
// returns raw PCM audio which we wrap into a WAV file, cache in Storage keyed by
// content hash (so repeated taps cost nothing), and serve via a Firebase
// download-token URL the browser plays with `new Audio()`.
//
// NOTE: Quran recitation is NOT synthesized here — it uses real recorded qirat
// (see activityContent.js audio URLs). This path covers everything else:
// Noorani Qaida, stories, math, worksheet steps, vocab, and arbitrary clicks.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { resolveCaller } from "../lib/caller.js";
import { loadAgentConfig } from "./agentConfig.js";
import { parseUsage } from "./llm.js";
import { recordCostEvent } from "../lib/costMeter.js";

// ─── PCM → WAV (pure, unit-tested) ────────────────────────────────────────────
// Gemini returns signed 16-bit little-endian mono PCM. Wrap it in a 44-byte
// canonical WAV header so browsers can play it directly.
export function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const dataSize = pcm.length;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);           // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);            // audio format 1 = PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

// Parse the sample rate out of a Gemini audio mimeType, e.g.
// "audio/L16;codec=pcm;rate=24000" → 24000. Defaults to 24000.
export function sampleRateFromMime(mime) {
  const m = /rate=(\d+)/.exec(mime || "");
  return m ? Number(m[1]) : 24000;
}

// ─── Gemini TTS call ──────────────────────────────────────────────────────────
export async function synthesizePcm({ text, voiceName, model, apiKey, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Gemini TTS ${res.status}: ${detail}`);
  }
  const json = await res.json();
  const part = (json?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!part) throw new Error("Gemini TTS returned no audio");
  return {
    pcm: Buffer.from(part.inlineData.data, "base64"),
    sampleRate: sampleRateFromMime(part.inlineData.mimeType),
    usage: parseUsage(json?.usageMetadata),
  };
}

// A brief delivery cue prepended on retry. Gemini's single-speaker TTS treats
// natural-language text before the content as a *style directive* it follows
// rather than reads aloud (e.g. "Say cheerfully: …"), so only `text` is spoken.
export const RECITE_CUE = "Say this slowly and clearly: ";

// Synthesize, with one retry for the bare-token case. Gemini intermittently
// returns NO audio for a single, isolated voweled glyph — exactly the Noorani
// Qaida letters (e.g. "بَ") tapped one at a time — while full words/sentences
// synthesize fine. When that happens we retry once with a short spoken cue that
// gives the model enough to articulate the letter. The retry ONLY fires on a
// genuine no-audio result, so every input that already works is untouched.
// `synth` is injected (the real synthesizePcm in prod) so this stays unit-testable.
export async function synthesizeSpeakable(synth, params) {
  try {
    return await synth(params);
  } catch (e) {
    if (/no audio/i.test(String(e?.message || ""))) {
      return await synth({ ...params, text: RECITE_CUE + params.text });
    }
    throw e;
  }
}

// ─── Callable ─────────────────────────────────────────────────────────────────
export const synthesizeSpeech = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60 },
  async (request) => {
    // Auth-scoped (any family member). The shared cache is keyed by content hash
    // (tenant-independent), but we capture the family for cost attribution.
    const { familyId, uid } = await resolveCaller(request);

    const db = (await import("firebase-admin/firestore")).getFirestore();
    const text = String(request.data?.text || "").trim().slice(0, 2000);
    if (!text) throw new HttpsError("invalid-argument", "text is required.");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { configured: false };

    const cfg = await loadAgentConfig(db, "tts");
    const model = cfg.model || "gemini-2.5-flash-preview-tts";
    const voiceName = String(request.data?.voiceName || cfg.voiceName || "Kore").slice(0, 60);

    // Cache key: model + voice + text. Same request never re-synthesizes.
    const hash = createHash("sha256").update(`${model}|${voiceName}|${text}`).digest("hex").slice(0, 40);
    const filePath = `tts-cache/${hash}.wav`;

    let bucket;
    try {
      bucket = getStorage().bucket();
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (exists) {
        const meta = (await file.getMetadata())[0];
        const token = meta?.metadata?.firebaseStorageDownloadTokens;
        if (token) {
          // Cache hit costs nothing, but log it so call counts stay honest.
          if (familyId) {
            await recordCostEvent(db, {
              familyId, kind: "tts", agentKey: "tts", model, source: "synthesizeSpeech",
              usage: {}, cached: true, uid,
            });
          }
          return { configured: true, cached: true, url: downloadUrl(bucket.name, filePath, token) };
        }
      }
    } catch {
      // Storage unavailable — fall through to synthesize + return inline data URL.
      bucket = null;
    }

    let wav, sampleRate;
    try {
      const out = await synthesizeSpeakable(synthesizePcm, { text, voiceName, model, apiKey });
      sampleRate = out.sampleRate;
      wav = pcmToWav(out.pcm, { sampleRate });
      // Record cost. Prefer real token usage; fall back to audio duration (16-bit
      // mono → 2 bytes/sample) so a usage-less response is still priced.
      if (familyId) {
        const audioSeconds = out.pcm.length / (sampleRate * 2);
        await recordCostEvent(db, {
          familyId, kind: "tts", agentKey: "tts", model, source: "synthesizeSpeech",
          usage: { ...(out.usage || {}), audioSeconds }, uid,
        });
      }
    } catch (e) {
      throw new HttpsError("internal", e?.message || "Speech synthesis failed.");
    }

    // Persist to the cache (best-effort) and return a token URL; if Storage is
    // unavailable, return a base64 data URL the browser can still play.
    if (bucket) {
      try {
        const token = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
        await bucket.file(filePath).save(wav, {
          resumable: false,
          metadata: {
            contentType: "audio/wav",
            cacheControl: "public, max-age=31536000",
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
        return { configured: true, cached: false, url: downloadUrl(bucket.name, filePath, token) };
      } catch (e) {
        console.warn(`[tts] storage save failed, considering inline fallback: ${e?.message || e}`);
      }
    }
    // Storage unavailable: only inline SMALL clips as a base64 data URL. Large WAVs
    // would bloat the callable response + the client cache (audit #17), so for those
    // we signal unavailable and let the client fall back to the browser voice.
    if (wav.length <= MAX_INLINE_WAV_BYTES) {
      return { configured: true, cached: false, url: `data:audio/wav;base64,${wav.toString("base64")}` };
    }
    console.warn(`[tts] clip too large to inline (${wav.length} bytes) and storage unavailable`);
    return { configured: true, cached: false, url: null, tooLarge: true };
  }
);

// ~1.5MB of WAV — comfortably covers a single word/sentence/short paragraph at
// 24kHz mono 16-bit (~32s) without returning multi-MB JSON payloads.
const MAX_INLINE_WAV_BYTES = 1_500_000;

function downloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
