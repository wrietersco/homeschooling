import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pcmToWav, sampleRateFromMime, synthesizeSpeakable, RECITE_CUE,
  synthesizeOpenAiPcm, resolveTtsProvider, effectiveTtsModel, effectiveTtsVoice, voicesForTts, ttsCacheHash,
  ttsModelAcceptsInstructions,
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
