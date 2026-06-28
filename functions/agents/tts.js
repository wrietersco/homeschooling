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
import { enforceFamilyTtsQuota } from "../platform/quota.js";

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

// ─── OpenAI TTS call ──────────────────────────────────────────────────────────
// OpenAI's /v1/audio/speech with response_format "pcm" returns raw 24kHz, 16-bit
// signed little-endian MONO PCM — byte-for-byte the same shape Gemini gives us —
// so the exact same pcmToWav + cache + cost pipeline downstream is reused. The
// audio response carries no token usage, so cost falls back to audioSeconds.
export async function synthesizeOpenAiPcm({ text, voiceName, model, apiKey, instructions = "", fetchImpl = globalThis.fetch }) {
  const body = { model, input: text, voice: voiceName, response_format: "pcm" };
  // Steerable delivery via `instructions` is supported by the 4o TTS line; the
  // legacy per-character models (tts-1 / tts-1-hd) reject the field, so attach it
  // only when the model accepts one (and never on those, which would 400).
  if (instructions && ttsModelAcceptsInstructions("openai", model)) body.instructions = instructions;
  const res = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`OpenAI TTS ${res.status}: ${detail}`);
  }
  const pcm = Buffer.from(await res.arrayBuffer());
  if (!pcm.length) throw new Error("OpenAI TTS returned no audio");
  return { pcm, sampleRate: 24000, usage: {} };
}

// ─── Provider registry ────────────────────────────────────────────────────────
// One entry per TTS backend. `synth` shares the { text, voiceName, model, apiKey }
// → { pcm, sampleRate, usage } contract, so synthesizeSpeech is provider-agnostic.
// `voices` lets us keep a configured voice only when it belongs to the active
// provider (a Gemini voice like "Kore" is meaningless to OpenAI and vice-versa).
// Voice sets per provider. OpenAI exposes 13 voices, but the legacy per-character
// models (tts-1 / tts-1-hd) support only 9 — ballad/verse/marin/cedar are
// gpt-4o-mini-tts-only. Source: developers.openai.com/api/docs/guides/text-to-speech.
const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];
const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const OPENAI_VOICES_LEGACY = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
const OPENAI_LEGACY_MODELS = ["tts-1", "tts-1-hd"];

export const TTS_PROVIDERS = {
  gemini: {
    synth: synthesizePcm,
    secret: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash-preview-tts",
    defaultVoice: "Kore",
    looksLikeModel: (m) => /gemini/i.test(m || ""),
    voices: GEMINI_VOICES,
    voicesForModel: () => GEMINI_VOICES, // same voices for every Gemini TTS model
  },
  openai: {
    synth: synthesizeOpenAiPcm,
    secret: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini-tts",
    defaultVoice: "alloy", // valid on every OpenAI TTS model
    looksLikeModel: (m) => !/gemini/i.test(m || ""),
    voices: OPENAI_VOICES,
    voicesForModel: (m) => (OPENAI_LEGACY_MODELS.includes(m) ? OPENAI_VOICES_LEGACY : OPENAI_VOICES),
  },
};

// Coerce a stored config (which may still hold the *other* provider's model/voice
// from before a provider switch) onto valid values for `provider`.
export function resolveTtsProvider(provider) {
  return TTS_PROVIDERS[provider] ? provider : "gemini";
}
export function effectiveTtsModel(provider, model) {
  const p = TTS_PROVIDERS[resolveTtsProvider(provider)];
  return model && p.looksLikeModel(model) ? model : p.defaultModel;
}
// Voices valid for a provider+model pair (model optional → full provider set).
export function voicesForTts(provider, model) {
  return TTS_PROVIDERS[resolveTtsProvider(provider)].voicesForModel(model);
}
// Keep a configured voice only when it's valid for the active provider AND model
// (e.g. "marin" is fine on gpt-4o-mini-tts but not on tts-1); else the default.
export function effectiveTtsVoice(provider, voice, model) {
  const p = TTS_PROVIDERS[resolveTtsProvider(provider)];
  return voice && p.voicesForModel(model).includes(voice) ? voice : p.defaultVoice;
}

// Does a (provider, model) accept a separate `instructions` steering field? Gemini
// has none (it is steered by a leading text cue, not a field), and OpenAI's legacy
// per-character models (tts-1 / tts-1-hd) reject it — only the 4o TTS line accepts
// one. Exported so the Qaida payload builder and the OpenAI synth agree on when a
// directive can ride the steering channel, so a directive that can't be applied is
// never attached (which would 400 the call AND poison the content-addressed cache).
export function ttsModelAcceptsInstructions(provider, model) {
  if (resolveTtsProvider(provider) !== "openai") return false;
  return !OPENAI_LEGACY_MODELS.includes(model);
}

// Content-addressed cache key shared by click-to-hear (synthesizeSpeech) and the
// Qaida audio worker, so a script voiced by one is free for the other. Keying on
// provider too means the two providers never collide on a (voice, text) pair.
export function ttsCacheHash({ provider, model, voiceName, text, instructions = "" }) {
  // Append the instructions segment ONLY when present, so existing cache keys
  // (no instructions) are byte-identical and previously-voiced clips still hit.
  const base = `${provider}|${model}|${voiceName}|${text}`;
  return createHash("sha256").update(instructions ? `${base}|${instructions}` : base).digest("hex").slice(0, 40);
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
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"], timeoutSeconds: 60 },
  async (request) => {
    // Auth-scoped (any family member). The shared cache is keyed by content hash
    // (tenant-independent), but we capture the family for cost attribution.
    const { familyId, uid } = await resolveCaller(request);

    const db = (await import("firebase-admin/firestore")).getFirestore();
    const text = String(request.data?.text || "").trim().slice(0, 2000);
    if (!text) throw new HttpsError("invalid-argument", "text is required.");

    const cfg = await loadAgentConfig(db, "tts");
    const provider = resolveTtsProvider(cfg.provider);
    const { synth, secret } = TTS_PROVIDERS[provider];

    const apiKey = process.env[secret];
    if (!apiKey) return { configured: false };

    const model = effectiveTtsModel(provider, cfg.model);
    const voiceName = effectiveTtsVoice(provider, String(request.data?.voiceName || cfg.voiceName || "").slice(0, 60), model);

    // Cache key: provider + model + voice + text. Same request never re-synthesizes,
    // and the two providers never collide on a shared (voice, text) pair.
    const hash = ttsCacheHash({ provider, model, voiceName, text });
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

    // Cache miss ⇒ a real Gemini call. Enforce this family's share of the shared
    // TTS daily pool (fair multi-tenant allocation). Throws resource-exhausted when
    // the family is over budget; the client then falls back to the browser voice.
    await enforceFamilyTtsQuota(db, familyId, model);

    let wav, sampleRate;
    try {
      const out = await synthesizeSpeakable(synth, { text, voiceName, model, apiKey });
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
