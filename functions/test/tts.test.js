import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pcmToWav, sampleRateFromMime, synthesizeSpeakable, RECITE_CUE,
  synthesizeOpenAiPcm, resolveTtsProvider, effectiveTtsModel, effectiveTtsVoice, voicesForTts, ttsCacheHash,
  ttsModelAcceptsInstructions, isKnownTtsModel, resolveTtsSelection, TTS_PICKER_MODEL,
  TONE_BY_CONTENT_KIND, OPENAI_INSTRUCTIONS_BY_CONTENT_KIND, ttsPayloadForKind,
} from "../agents/tts.js";

test("sampleRateFromMime parses rate, defaults to 24000", () => {
  assert.equal(sampleRateFromMime("audio/L16;codec=pcm;rate=24000"), 24000);
  assert.equal(sampleRateFromMime("audio/L16;rate=16000"), 16000);
  assert.equal(sampleRateFromMime("audio/wav"), 24000);
  assert.equal(sampleRateFromMime(undefined), 24000);
});

test("pcmToWav prepends a valid 44-byte canonical WAV header", () => {
  const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const wav = pcmToWav(pcm, { sampleRate: 24000 });

  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 12, 16), "fmt ");
  assert.equal(wav.toString("ascii", 36, 40), "data");

  assert.equal(wav.readUInt32LE(4), 36 + pcm.length); // RIFF chunk size
  assert.equal(wav.readUInt16LE(20), 1);              // PCM format
  assert.equal(wav.readUInt16LE(22), 1);              // mono
  assert.equal(wav.readUInt32LE(24), 24000);          // sample rate
  assert.equal(wav.readUInt16LE(34), 16);             // bits per sample
  assert.equal(wav.readUInt32LE(40), pcm.length);     // data size

  // PCM payload copied verbatim after the header.
  assert.deepEqual(wav.subarray(44), pcm);
});

test("pcmToWav byteRate + blockAlign are consistent for 16-bit mono", () => {
  const wav = pcmToWav(Buffer.alloc(4), { sampleRate: 16000 });
  assert.equal(wav.readUInt32LE(28), 16000 * 1 * 2); // byteRate = rate*channels*bytesPerSample
  assert.equal(wav.readUInt16LE(32), 2);             // blockAlign = channels*bytesPerSample
});

test("synthesizeSpeakable passes a normal result straight through (no retry)", async () => {
  const calls = [];
  const synth = async (p) => { calls.push(p.text); return { pcm: Buffer.from([1]), sampleRate: 24000 }; };
  const out = await synthesizeSpeakable(synth, { text: "بِسْمِ", voiceName: "Kore" });
  assert.deepEqual(calls, ["بِسْمِ"]);           // called once, unframed
  assert.equal(out.sampleRate, 24000);
});

test("synthesizeSpeakable retries a bare letter once with the recitation cue", async () => {
  const calls = [];
  const synth = async (p) => {
    calls.push(p.text);
    if (calls.length === 1) throw new Error("Gemini TTS returned no audio");
    return { pcm: Buffer.from([2]), sampleRate: 24000 };
  };
  const out = await synthesizeSpeakable(synth, { text: "بَ", voiceName: "Kore" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "بَ");                  // first try: bare letter
  assert.equal(calls[1], RECITE_CUE + "بَ");     // retry: cue + letter
  assert.equal(out.sampleRate, 24000);
});

test("synthesizeSpeakable does NOT retry on non-'no audio' errors", async () => {
  let n = 0;
  const synth = async () => { n += 1; throw new Error("Gemini TTS 429: rate limited"); };
  await assert.rejects(
    () => synthesizeSpeakable(synth, { text: "بَ" }),
    /rate limited/
  );
  assert.equal(n, 1); // a transient/quota error is surfaced, not masked by a retry
});

test("synthesizeSpeakable surfaces a still-empty retry as the no-audio error", async () => {
  let n = 0;
  const synth = async () => { n += 1; throw new Error("Gemini TTS returned no audio"); };
  await assert.rejects(
    () => synthesizeSpeakable(synth, { text: "بَ" }),
    /no audio/
  );
  assert.equal(n, 2); // tried once, retried once, then gives up (client falls back)
});

// ─── OpenAI TTS provider ──────────────────────────────────────────────────────
test("synthesizeOpenAiPcm posts to OpenAI and returns 24kHz mono PCM", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer };
  };
  const out = await synthesizeOpenAiPcm({ text: "hello", voiceName: "alloy", model: "gpt-4o-mini-tts", apiKey: "sk-test", fetchImpl });
  assert.equal(out.sampleRate, 24000);          // matches Gemini's pcmToWav default
  assert.equal(out.pcm.length, 4);
  assert.match(captured.url, /api\.openai\.com\/v1\/audio\/speech/);
  assert.equal(captured.opts.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(
    { model: body.model, input: body.input, voice: body.voice, response_format: body.response_format },
    { model: "gpt-4o-mini-tts", input: "hello", voice: "alloy", response_format: "pcm" }
  );
});

test("synthesizeOpenAiPcm throws with status on a non-2xx response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "bad key" });
  await assert.rejects(
    () => synthesizeOpenAiPcm({ text: "x", voiceName: "alloy", model: "tts-1", apiKey: "bad", fetchImpl }),
    /OpenAI TTS 401/
  );
});

test("synthesizeOpenAiPcm treats an empty body as a no-audio error", async () => {
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(
    () => synthesizeOpenAiPcm({ text: "x", voiceName: "alloy", model: "tts-1", apiKey: "k", fetchImpl }),
    /no audio/
  );
});

test("synthesizeOpenAiPcm attaches `instructions` only to gpt-4o-mini-tts (tts-1 would 400)", async () => {
  const bodies = [];
  const fetchImpl = async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, arrayBuffer: async () => Uint8Array.from([1]).buffer }; };
  await synthesizeOpenAiPcm({ text: "بَ", voiceName: "alloy", model: "gpt-4o-mini-tts", apiKey: "k", instructions: "Recite in Arabic.", fetchImpl });
  await synthesizeOpenAiPcm({ text: "بَ", voiceName: "alloy", model: "tts-1", apiKey: "k", instructions: "Recite in Arabic.", fetchImpl });
  assert.equal(bodies[0].instructions, "Recite in Arabic."); // newer model → steered
  assert.equal(bodies[1].instructions, undefined);           // legacy model → field omitted
});

test("ttsModelAcceptsInstructions: only the OpenAI 4o TTS line accepts a steering field", () => {
  assert.equal(ttsModelAcceptsInstructions("openai", "gpt-4o-mini-tts"), true);
  // Legacy per-character models reject the field.
  assert.equal(ttsModelAcceptsInstructions("openai", "tts-1"), false);
  assert.equal(ttsModelAcceptsInstructions("openai", "tts-1-hd"), false);
  // Gemini has no instructions field at all (steered by a leading text cue).
  assert.equal(ttsModelAcceptsInstructions("gemini", "gemini-2.5-flash-preview-tts"), false);
});

test("ttsCacheHash: instructions change the key only when present (existing keys stay valid)", () => {
  const base = { provider: "openai", model: "gpt-4o-mini-tts", voiceName: "alloy", text: "بَ" };
  assert.equal(ttsCacheHash(base), ttsCacheHash({ ...base, instructions: "" })); // back-compat
  const withInstr = ttsCacheHash({ ...base, instructions: "Recite in Arabic." });
  assert.notEqual(withInstr, ttsCacheHash(base));
  assert.equal(withInstr, ttsCacheHash({ ...base, instructions: "Recite in Arabic." })); // stable
});

// ─── Default emotional tone by content kind ───────────────────────────────────
test("ttsPayloadForKind: no kind and no override → plain text, no instructions", () => {
  assert.deepEqual(ttsPayloadForKind("hello", "", "gemini", "gemini-2.5-flash-preview-tts"), { text: "hello", instructions: "" });
  assert.deepEqual(ttsPayloadForKind("hello", "unknown-kind", "openai", "gpt-4o-mini-tts"), { text: "hello", instructions: "" });
});

test("ttsPayloadForKind: Gemini gets the tone baked into the text as a leading cue", () => {
  const { text, instructions } = ttsPayloadForKind("بِسْمِ", "quran", "gemini", "gemini-2.5-flash-preview-tts");
  assert.equal(instructions, ""); // Gemini has no instructions field
  assert.ok(text.startsWith(TONE_BY_CONTENT_KIND.quran));
  assert.ok(text.endsWith("بِسْمِ")); // original text preserved verbatim at the end
});

test("ttsPayloadForKind: OpenAI's steerable model gets the RICHER structured instructions, text untouched", () => {
  const { text, instructions } = ttsPayloadForKind("Once upon a time", "story", "openai", "gpt-4o-mini-tts");
  assert.equal(text, "Once upon a time");
  assert.equal(instructions, OPENAI_INSTRUCTIONS_BY_CONTENT_KIND.story);
  assert.notEqual(instructions, TONE_BY_CONTENT_KIND.story); // NOT the flat Gemini-style sentence
  // Structured Voice/Tone/Pacing/Emotion direction — what actually moves gpt-4o-mini-tts.
  assert.match(instructions, /Voice:.*Tone:.*Pacing:.*Emotion:/s);
});

test("every OPENAI_INSTRUCTIONS_BY_CONTENT_KIND entry follows the Voice/Tone/Pacing/Emotion structure", () => {
  for (const [kind, text] of Object.entries(OPENAI_INSTRUCTIONS_BY_CONTENT_KIND)) {
    assert.match(text, /Voice:/, `${kind} missing Voice:`);
    assert.match(text, /Tone:/, `${kind} missing Tone:`);
    assert.match(text, /Pacing:/, `${kind} missing Pacing:`);
    assert.match(text, /Emotion:/, `${kind} missing Emotion:`);
  }
  // Same kind coverage as the Gemini-side map — no kind falls back to flat/no tone on OpenAI.
  assert.deepEqual(Object.keys(OPENAI_INSTRUCTIONS_BY_CONTENT_KIND).sort(), Object.keys(TONE_BY_CONTENT_KIND).sort());
});

test("ttsPayloadForKind: OpenAI's legacy models (no instructions field) get plain text, no tone", () => {
  const { text, instructions } = ttsPayloadForKind("Once upon a time", "story", "openai", "tts-1");
  assert.equal(text, "Once upon a time");
  assert.equal(instructions, "");
});

test("ttsPayloadForKind: an explicit instructions override wins over the kind default", () => {
  const gemini = ttsPayloadForKind("hi", "quran", "gemini", "gemini-2.5-flash-preview-tts", "Sound extra sleepy.");
  assert.ok(gemini.text.startsWith("Sound extra sleepy."));
  assert.ok(!gemini.text.includes(TONE_BY_CONTENT_KIND.quran));

  const openai = ttsPayloadForKind("hi", "quran", "openai", "gpt-4o-mini-tts", "Sound extra sleepy.");
  assert.equal(openai.instructions, "Sound extra sleepy.");
});

test("every TONE_BY_CONTENT_KIND entry produces a distinct cache key for the same text/voice", () => {
  const keys = Object.keys(TONE_BY_CONTENT_KIND).map((k) => {
    const { text, instructions } = ttsPayloadForKind("سلام", k, "gemini", "gemini-2.5-flash-preview-tts");
    return ttsCacheHash({ provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore", text, instructions });
  });
  assert.equal(new Set(keys).size, keys.length); // no two kinds collide
  const plain = ttsCacheHash({ provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore", text: "سلام", instructions: "" });
  assert.ok(!keys.includes(plain)); // toned clips never collide with the untoned one either
});

test("resolveTtsProvider falls back to gemini for unknown providers", () => {
  assert.equal(resolveTtsProvider("openai"), "openai");
  assert.equal(resolveTtsProvider("gemini"), "gemini");
  assert.equal(resolveTtsProvider("bogus"), "gemini");
  assert.equal(resolveTtsProvider(undefined), "gemini");
});

test("effectiveTtsModel/Voice coerce stale cross-provider config onto the active provider", () => {
  // Matching config is preserved.
  assert.equal(effectiveTtsModel("gemini", "gemini-2.5-flash-preview-tts"), "gemini-2.5-flash-preview-tts");
  assert.equal(effectiveTtsModel("openai", "tts-1"), "tts-1");
  // A leftover model from the other provider snaps to the active provider's default.
  assert.equal(effectiveTtsModel("openai", "gemini-2.5-flash-preview-tts"), "gpt-4o-mini-tts");
  assert.equal(effectiveTtsModel("gemini", "tts-1"), "gemini-2.5-flash-preview-tts");

  assert.equal(effectiveTtsVoice("openai", "nova"), "nova");
  assert.equal(effectiveTtsVoice("gemini", "Puck"), "Puck");
  assert.equal(effectiveTtsVoice("openai", "Kore"), "alloy"); // Gemini voice → OpenAI default
  assert.equal(effectiveTtsVoice("gemini", "alloy"), "Kore"); // OpenAI voice → Gemini default
});

test("OpenAI voice resolution is model-aware (legacy tts-1/-hd support only 9 voices)", () => {
  // gpt-4o-mini-tts supports all 13 incl. marin/cedar/ballad/verse.
  assert.equal(voicesForTts("openai", "gpt-4o-mini-tts").length, 13);
  assert.equal(effectiveTtsVoice("openai", "marin", "gpt-4o-mini-tts"), "marin");
  assert.equal(effectiveTtsVoice("openai", "cedar", "gpt-4o-mini-tts"), "cedar");
  // tts-1 / tts-1-hd support only 9 — the gpt-4o-mini-only voices fall back to alloy.
  assert.equal(voicesForTts("openai", "tts-1").length, 9);
  assert.ok(!voicesForTts("openai", "tts-1").includes("marin"));
  assert.equal(effectiveTtsVoice("openai", "marin", "tts-1"), "alloy");
  assert.equal(effectiveTtsVoice("openai", "ballad", "tts-1-hd"), "alloy");
  assert.equal(effectiveTtsVoice("openai", "coral", "tts-1"), "coral"); // a supported one stays
  // Gemini uses the same 8 voices for every Gemini TTS model.
  assert.equal(voicesForTts("gemini", "gemini-2.5-flash-preview-tts").length, 8);
});

// ─── Explicit voice selection (per-element voice picker) ──────────────────────
test("isKnownTtsModel: only catalog ids for the right provider pass", () => {
  assert.equal(isKnownTtsModel("gemini", "gemini-2.5-pro-preview-tts"), true);
  assert.equal(isKnownTtsModel("openai", "gpt-4o-mini-tts"), true);
  assert.equal(isKnownTtsModel("openai", "tts-1"), true);
  // Wrong provider for the id, or an unknown id, is rejected.
  assert.equal(isKnownTtsModel("openai", "gemini-2.5-pro-preview-tts"), false);
  assert.equal(isKnownTtsModel("gemini", "gpt-4o-mini-tts"), false);
  assert.equal(isKnownTtsModel("openai", "totally-made-up-tts"), false);
  assert.equal(isKnownTtsModel("openai", ""), false);
});

test("TTS_PICKER_MODEL uses Gemini's finest + OpenAI 4o", () => {
  assert.equal(TTS_PICKER_MODEL.gemini, "gemini-2.5-pro-preview-tts");
  assert.equal(TTS_PICKER_MODEL.openai, "gpt-4o-mini-tts");
});

test("resolveTtsSelection: no explicit selection falls back to saved config", () => {
  const sel = resolveTtsSelection({
    config: { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" },
    isAvailable: () => true,
  });
  assert.deepEqual(sel, { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" });
});

test("resolveTtsSelection: a bare voiceName (no provider) coerces onto the config provider", () => {
  const sel = resolveTtsSelection({
    voiceName: "Puck",
    config: { provider: "gemini", model: "gemini-2.5-flash-preview-tts" },
    isAvailable: () => true,
  });
  assert.deepEqual(sel, { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Puck" });
});

test("resolveTtsSelection: an explicit, AVAILABLE provider+model+voice is honored", () => {
  const sel = resolveTtsSelection({
    provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin",
    config: { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" },
    isAvailable: (p) => p === "openai",
  });
  assert.deepEqual(sel, { provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin" });
});

test("resolveTtsSelection: an explicit provider that is UNAVAILABLE falls back to config", () => {
  const sel = resolveTtsSelection({
    provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin",
    config: { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" },
    isAvailable: (p) => p === "gemini", // openai not configured
  });
  assert.deepEqual(sel, { provider: "gemini", model: "gemini-2.5-flash-preview-tts", voiceName: "Kore" });
});

test("resolveTtsSelection: an unknown model for an honored provider snaps to its default", () => {
  const sel = resolveTtsSelection({
    provider: "openai", model: "evil-model", voiceName: "marin",
    config: {},
    isAvailable: () => true,
  });
  assert.equal(sel.provider, "openai");
  assert.equal(sel.model, "gpt-4o-mini-tts"); // provider default, not the bogus string
  assert.equal(sel.voiceName, "marin");       // valid on the default model
});

test("resolveTtsSelection: an out-of-set voice for the chosen model snaps to the provider default voice", () => {
  const sel = resolveTtsSelection({
    provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "marin", // marin is OpenAI-only
    config: {},
    isAvailable: () => true,
  });
  assert.deepEqual(sel, { provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Kore" });
});

test("resolveTtsSelection: distinct selections produce distinct cache keys (no charge on repeat)", () => {
  const a = resolveTtsSelection({ provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin", isAvailable: () => true });
  const b = resolveTtsSelection({ provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Kore", isAvailable: () => true });
  const text = "بِسْمِ";
  assert.notEqual(ttsCacheHash({ ...a, text }), ttsCacheHash({ ...b, text }));
  // Same selection ⇒ identical key ⇒ a cache hit (free) on the next regenerate.
  assert.equal(ttsCacheHash({ ...a, text }), ttsCacheHash({ ...a, text }));
});

test("ttsCacheHash is deterministic and provider-sensitive (shared by click-to-hear + Qaida)", () => {
  const base = { model: "tts-1", voiceName: "alloy", text: "بِسْمِ" };
  const a = ttsCacheHash({ provider: "openai", ...base });
  assert.equal(a, ttsCacheHash({ provider: "openai", ...base })); // stable
  assert.equal(a.length, 40);
  // Provider, model, voice and text each change the key — no cross-provider collision.
  assert.notEqual(a, ttsCacheHash({ provider: "gemini", ...base }));
  assert.notEqual(a, ttsCacheHash({ provider: "openai", ...base, voiceName: "nova" }));
  assert.notEqual(a, ttsCacheHash({ provider: "openai", ...base, text: "أَ" }));
});
