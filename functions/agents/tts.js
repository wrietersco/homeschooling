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
import { MODEL_CATALOG } from "./modelCatalog.js";

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

// Known TTS model ids per provider, taken from the curated catalog. An explicit
// client-supplied model is honored ONLY if it's on this allowlist, so a stray model
// string can never reach the provider call or poison the content-addressed cache key.
const TTS_MODEL_IDS = (MODEL_CATALOG.tts || []).reduce((acc, m) => {
  (acc[m.provider] ||= new Set()).add(m.id);
  return acc;
}, {});
export function isKnownTtsModel(provider, model) {
  const p = resolveTtsProvider(provider);
  return Boolean(model) && Boolean(TTS_MODEL_IDS[p]?.has(model)) && TTS_PROVIDERS[p].looksLikeModel(model);
}

// The model each provider uses for USER-DRIVEN voice regeneration (the per-element
// voice picker) — distinct from the platform default (`TTS_PROVIDERS[p].defaultModel`)
// used for ordinary click-to-hear. Per product spec: Gemini's finest TTS, OpenAI's 4o.
export const TTS_PICKER_MODEL = { gemini: "gemini-2.5-pro-preview-tts", openai: "gpt-4o-mini-tts" };

// Resolve the effective (provider, model, voice) for ONE synthesis call. An explicit
// client selection is honored only when its provider is known AND available (key set);
// otherwise we fall back to the saved `tts` agent config — exactly today's behaviour
// when nothing explicit is passed. Pure + unit-tested; the callable injects
// `isAvailable` from the runtime env. A bare `voiceName` (no provider) still applies,
// coerced onto the config provider/model.
export function resolveTtsSelection({ provider, model, voiceName, config = {}, isAvailable = () => true } = {}) {
  if (provider && TTS_PROVIDERS[provider] && isAvailable(provider)) {
    const m = isKnownTtsModel(provider, model) ? model : TTS_PROVIDERS[provider].defaultModel;
    return { provider, model: m, voiceName: effectiveTtsVoice(provider, voiceName || "", m) };
  }
  const p = resolveTtsProvider(config.provider);
  const m = effectiveTtsModel(p, config.model);
  return { provider: p, model: m, voiceName: effectiveTtsVoice(p, voiceName || config.voiceName || "", m) };
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

// ─── Default emotional tone by content kind ──────────────────────────────────
// Every click-to-hear / regenerated clip should sound appropriately expressive
// without a parent having to tune it per element — a Quran ayah, a bedtime
// story, and a math problem should not all be read in the same flat voice.
// Same per-provider steering mechanism as qaidaTtsPayload (platform/qaidaImport.js):
//   • Gemini (no instructions field) — baked into `text` as a leading style cue,
//     which Gemini follows as a directive and does NOT speak (see RECITE_CUE).
//     Kept short/imperative here — a long prepended block risks Gemini treating
//     part of it as content to read instead of a directive.
//   • OpenAI gpt-4o-mini-tts — the `instructions` steering field. This model
//     responds far more reliably to structured, multi-dimension direction
//     (separate Voice/Tone/Pacing/Emotion/Pronunciation lines) than to a single
//     adjective-laden sentence — a flat single-sentence instruction is why the
//     OpenAI voices were still sounding emotionless.
//   • OpenAI tts-1 / tts-1-hd — reject an instructions field, so none is
//     attached (would 400 the call and poison the cache key); plain text plays.
export const TONE_BY_CONTENT_KIND = {
  quran: "Recite reverently, slowly, and clearly, honoring the sacred text.",
  qaida: "Speak clearly, patiently, and slowly, like a teacher guiding a beginner reader.",
  dialogue: "Speak naturally and expressively, in character for this line.",
  story: "Narrate warmly and engagingly, like telling a story to a child.",
  tips: "Speak warmly, calmly, and supportively, like a trusted mentor advising a parent.",
  vocab: "Speak clearly and simply, like introducing a new word to a young learner.",
  instructional: "Speak clearly, neutrally, and at an easy, unhurried pace.",
};

// Richer, structured instructions for OpenAI's `instructions` field specifically
// (gpt-4o-mini-tts only — see ttsModelAcceptsInstructions). Deliberately more
// elaborate than TONE_BY_CONTENT_KIND: this is a dedicated steering field, not
// spoken text, so there's no risk of it bleeding into the audio, and the model
// follows this Voice/Tone/Pacing/Emotion/Pronunciation structure noticeably
// better than a single sentence.
export const OPENAI_INSTRUCTIONS_BY_CONTENT_KIND = {
  quran: "Voice: Warm but reverent, with the measured gravity of reciting sacred text. "
    + "Tone: Calm and reverent, never excited. Pacing: Slow and deliberate, with natural pauses between phrases. "
    + "Emotion: Quiet devotion. Pronunciation: Precise, honoring every syllable.",
  qaida: "Voice: Patient and encouraging, like a kind teacher with a beginner reader. Tone: Warm and supportive. "
    + "Pacing: Slow, with a clear pause after each letter or sound. Emotion: Gentle encouragement, never rushed. "
    + "Pronunciation: Crisp and exaggeratedly clear.",
  dialogue: "Voice: Lively and natural, fully in character for this line. "
    + "Tone: Match the emotion the line implies — playful, curious, surprised. Pacing: Conversational, with natural rhythm. "
    + "Emotion: Genuine and varied, not narrator-flat. Pronunciation: Clear but relaxed, like real conversation.",
  story: "Voice: Warm, animated storyteller, like reading a bedtime story aloud. "
    + "Tone: Engaging and expressive — let the emotion of each moment come through. "
    + "Pacing: Quicker for excitement, slower for suspense or tenderness. Emotion: Genuine warmth and wonder. "
    + "Pronunciation: Clear and lightly theatrical on key story beats.",
  tips: "Voice: Warm, calm, and supportive, like a trusted mentor speaking privately to a parent. "
    + "Tone: Encouraging and reassuring, never clinical. Pacing: Relaxed and steady. "
    + "Emotion: Genuine warmth, quiet confidence.",
  vocab: "Voice: Bright and clear, like introducing a fun new word to a young child. Tone: Cheerful and encouraging. "
    + "Pacing: Slightly slower, clear pause after the word. Emotion: Light enthusiasm. "
    + "Pronunciation: Very precise, syllable by syllable if needed.",
  instructional: "Voice: Clear, neutral, and steady, like giving step-by-step directions. Tone: Calm and matter-of-fact. "
    + "Pacing: Even and unhurried, brief pause between steps. Emotion: Neutral — clarity over expressiveness.",
};

// Build { text, instructions } for a synthesis call, folding in the default tone
// for `contentKind` (if any) via the right channel for (provider, model). An
// explicit `instructions` override wins over the kind default; an unrecognized
// or absent kind falls through to plain text (no tone applied). OpenAI gets its
// own richer instruction set (see OPENAI_INSTRUCTIONS_BY_CONTENT_KIND); an
// explicit override applies verbatim to whichever channel is available.
export function ttsPayloadForKind(text, contentKind, provider, model, explicitInstructions = "") {
  if (resolveTtsProvider(provider) === "gemini") {
    const tone = explicitInstructions || TONE_BY_CONTENT_KIND[contentKind] || "";
    return tone ? { text: `${tone}\n\n${text}`, instructions: "" } : { text, instructions: "" };
  }
  if (ttsModelAcceptsInstructions(provider, model)) {
    const tone = explicitInstructions || OPENAI_INSTRUCTIONS_BY_CONTENT_KIND[contentKind] || "";
    return { text, instructions: tone };
  }
  return { text, instructions: "" };
}

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
    // Honor an explicit per-element voice choice (from the activity voice picker) when
    // its provider is configured; otherwise fall back to the saved `tts` config.
    const isAvailable = (pv) => Boolean(TTS_PROVIDERS[pv] && process.env[TTS_PROVIDERS[pv].secret]);
    const { provider, model, voiceName } = resolveTtsSelection({
      provider: String(request.data?.provider || "").trim() || undefined,
      model: String(request.data?.model || "").trim() || undefined,
      voiceName: String(request.data?.voiceName || "").slice(0, 60),
      config: cfg,
      isAvailable,
    });
    const { synth, secret } = TTS_PROVIDERS[provider];

    const apiKey = process.env[secret];
    if (!apiKey) return { configured: false };

    // Fold in a default emotional tone for this content kind (a Quran ayah,
    // a bedtime story, and a math problem shouldn't all read the same way),
    // unless the caller passes an explicit override. `spokenText` carries any
    // Gemini style cue baked in; `instructions` carries OpenAI's steering field.
    const contentKind = String(request.data?.contentKind || "").trim().slice(0, 40);
    const explicitInstructions = String(request.data?.instructions || "").trim().slice(0, 300);
    const { text: spokenText, instructions } = ttsPayloadForKind(text, contentKind, provider, model, explicitInstructions);

    // Cache key: provider + model + voice + (tone-applied) text + instructions.
    // Same request never re-synthesizes; the two providers never collide on a
    // shared (voice, text) pair; a different tone for the same raw text gets
    // its own entry since `spokenText`/`instructions` differ.
    const hash = ttsCacheHash({ provider, model, voiceName, text: spokenText, instructions });
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
      const out = await synthesizeSpeakable(synth, { text: spokenText, voiceName, model, apiKey, instructions });
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

// ─── Voice catalog for the per-element voice picker ─────────────────────────────
// Auth-scoped (any family member). Returns the consolidated voice list the activity
// voice picker renders — voices from BOTH providers, each tagged with its provider's
// regeneration model — plus which providers are actually configured (so the UI can
// disable an unavailable provider's group). No secrets leave the function.
export const getTtsVoiceCatalog = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"] },
  async (request) => {
    await resolveCaller(request); // any signed-in family member
    const providers = {};
    for (const [key, p] of Object.entries(TTS_PROVIDERS)) {
      const model = TTS_PICKER_MODEL[key] || p.defaultModel;
      providers[key] = {
        available: Boolean(process.env[p.secret]),
        defaultModel: model,
        voices: voicesForTts(key, model),
      };
    }
    return { providers };
  }
);
