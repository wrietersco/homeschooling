// Server-side Kokoro — the free premium voice, running on the platform's own
// backend (a gen2 function = Cloud Run). This is the same Kokoro-82M model the
// local developer bridge uses, but the q8 weights are BUNDLED into the
// functions package (functions/models/kokoro): no API key, no per-clip
// billing, no first-use model download, works on every warm instance. Clips
// encode to MP3 exactly like the bridge encodes them; the studio attaches them
// through the same Storage + pack-field path as every other voice engine.
import { fileURLToPath } from "node:url";
import path from "node:path";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_VOICE = "af_heart";

// functions/lib → functions/models/kokoro
export const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models", "kokoro");

// The bridge's exact MP3 encoder (mono, 80 kbps) — pure + unit-tested. Takes
// the lamejs module so tests can hand in the real thing.
export function encodeMp3(lamejs, float32, sampleRate, kbps = 80) {
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const int16 = Int16Array.from(float32, (v) => {
    const s = Math.max(-1, Math.min(1, v));
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  });
  const chunks = [];
  for (let i = 0; i < int16.length; i += 1152) {
    const out = encoder.encodeBuffer(int16.subarray(i, i + 1152));
    if (out.length) chunks.push(Uint8Array.from(out));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Uint8Array.from(tail));
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}

// Build one engine from explicit modules — the unit-testable core. The model
// loads lazily and once, so a warm instance reuses it across requests.
export function createKokoroEngine({ KokoroTTS, lamejs, modelId = KOKORO_MODEL_ID, voice = KOKORO_VOICE, modelDir = MODEL_DIR, allowRemote = false }) {
  let ttsPromise = null;
  const load = () => {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        const { env } = await import("@huggingface/transformers");
        env.allowLocalModels = true;
        env.allowRemoteModels = allowRemote; // bundled weights — never reach the network at runtime
        env.localModelPath = modelDir;
        return KokoroTTS.from_pretrained(modelId, { dtype: "q8" });
      })();
    }
    return ttsPromise;
  };
  return {
    // Same call shape as the local bridge's engine: text in, MP3 base64 out.
    async generate(text, { voice: v = voice, speed = 1 } = {}) {
      const tts = await load();
      const out = await tts.generate(text, { voice: v, speed });
      return {
        mp3Base64: Buffer.from(encodeMp3(lamejs, out.audio, out.sampling_rate)).toString("base64"),
        seconds: out.audio.length / out.sampling_rate,
      };
    },
  };
}

// The function's entry point: pulls the heavy libraries only when the first
// clip arrives, then keeps the warm engine for the instance's lifetime.
let warm = null;
export async function getKokoroEngine() {
  if (!warm) {
    const [{ KokoroTTS }, { default: lamejs }] = await Promise.all([
      import("kokoro-js"),
      import("@breezystack/lamejs"),
    ]);
    warm = createKokoroEngine({ KokoroTTS, lamejs });
  }
  return warm;
}
