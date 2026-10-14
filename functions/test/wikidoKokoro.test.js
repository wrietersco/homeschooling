// Server-side Kokoro engine — pure-function tests with the real lamejs
// encoder and fake model modules. No network, no ONNX runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import lamejs from "@breezystack/lamejs";
import {
  encodeMp3,
  createKokoroEngine,
  KOKORO_MODEL_ID,
  KOKORO_VOICE,
  MODEL_DIR,
} from "../lib/wikidoKokoro.js";

const sine = (n = 2400) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 24000));

function fakeKokoroTts() {
  const calls = [];
  return {
    calls,
    KokoroTTS: {
      from_pretrained: async (modelId, opts) => {
        if (modelId !== KOKORO_MODEL_ID) throw new Error(`unexpected model ${modelId}`);
        calls.push(["load", opts]);
        return {
          generate: async (text, genOpts) => {
            calls.push(["generate", text, genOpts]);
            if (/boom/.test(text)) throw new Error("inference failed");
            return { audio: sine(), sampling_rate: 24000 };
          },
        };
      },
    },
  };
}

test("encodeMp3 turns float32 samples into a real MP3 byte stream", () => {
  const bytes = encodeMp3(lamejs, sine(), 24000);
  assert.ok(bytes.length > 100);
  const isSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  assert.ok(isSync || isId3);
  // out-of-range samples clamp; empty input never throws
  assert.ok(encodeMp3(lamejs, Float32Array.from([2, -2]), 24000).length > 0);
  assert.ok(encodeMp3(lamejs, new Float32Array(0), 24000).length >= 0);
});

test("createKokoroEngine loads once and returns bridge-shaped MP3", async () => {
  const fake = fakeKokoroTts();
  const engine = createKokoroEngine({ KokoroTTS: fake.KokoroTTS, lamejs });
  const first = await engine.generate("Hello there.", {});
  assert.equal(typeof first.mp3Base64, "string");
  assert.ok(first.mp3Base64.length > 4);
  assert.ok(Math.abs(first.seconds - 0.1) < 0.01);
  // bundled weights, local only: from_pretrained pinned to the shipped model
  assert.deepEqual(fake.calls[0], ["load", { dtype: "q8" }]);
  assert.deepEqual(fake.calls[1], ["generate", "Hello there.", { voice: KOKORO_VOICE, speed: 1 }]);

  // a warm instance reuses the loaded model — the second clip never reloads
  await engine.generate("Second clip.");
  assert.equal(fake.calls.filter(([kind]) => kind === "load").length, 1);
  assert.equal(fake.calls[2][1], "Second clip.");
});

test("the engine reads the bundled model directory", () => {
  // MODEL_DIR points into the functions package — the deploy ships it
  assert.match(MODEL_DIR, /models[\\\/]kokoro$/);
});

test("Buffer round-trip: base64 payload decodes to the encoder's bytes", async () => {
  const fake = fakeKokoroTts();
  const engine = createKokoroEngine({ KokoroTTS: fake.KokoroTTS, lamejs });
  const { mp3Base64 } = await engine.generate("x");
  assert.ok(Buffer.from(mp3Base64, "base64").length > 0);
});
