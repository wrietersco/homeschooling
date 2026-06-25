import { test } from "node:test";
import assert from "node:assert/strict";
import { pcmToWav, sampleRateFromMime, synthesizeSpeakable, RECITE_CUE } from "../agents/tts.js";

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
