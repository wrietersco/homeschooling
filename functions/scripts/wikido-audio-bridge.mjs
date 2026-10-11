// Wikido voiceover bridge — the local half of studio audio.
//
// Kokoro TTS runs on the developer's machine (it needs the local ONNX runtime),
// while the superadmin curates topics in the browser — possibly against prod.
// This tiny localhost server closes that gap: the Wikido Studio detects it,
// sends the exact on-screen text of every scene + hotspot card, and gets studio-
// quality MP3s back, which it uploads to Firebase Storage through the
// superadmin-only attachWikidoAudio callable. Nothing here touches Firestore or
// Storage — the bridge is a stateless synthesizer.
//
//   npm run wikido:bridge
//
// Endpoints:
//   GET  /status   → { ok, engine, voice, model }
//   POST /generate { items: [{ id, text }], voice?, speed? }
//                  → { results: [{ id, mp3, seconds }], failed: [{ id, error }] }
// (mp3 is base64; the caller uploads it via attachWikidoAudio)
import http from "node:http";
import { KokoroTTS } from "kokoro-js";
import lamejs from "@breezystack/lamejs";

const PORT = Number(process.env.WIKIDO_BRIDGE_PORT || 8787);
const DEFAULT_VOICE = process.env.WIKIDO_BRIDGE_VOICE || "af_heart";
const KBPS = 80;

let tts = null;          // lazy — the model (~90 MB) loads on first use
let loadingPromise = null;

async function engine() {
  if (tts) return tts;
  if (!loadingPromise) {
    console.log("Loading Kokoro-82M (first run downloads ~90 MB from Hugging Face)…");
    loadingPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" })
      .then((m) => { tts = m; console.log("Kokoro ready."); return m; });
  }
  return loadingPromise;
}

function encodeMp3(float32, sampleRate) {
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, KBPS);
  const int16 = Int16Array.from(float32, (v) => {
    const s = Math.max(-1, Math.min(1, v));
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  });
  const chunks = [];
  for (let i = 0; i < int16.length; i += 1152) {
    const out = encoder.encodeBuffer(int16.subarray(i, i + 1152));
    if (out.length) chunks.push(Buffer.from(out));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

function json(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { json(res, 204, {}); return; }

  if (req.method === "GET" && req.url === "/status") {
    json(res, 200, { ok: true, engine: "kokoro", model: "Kokoro-82M (q8)", voice: DEFAULT_VOICE, sampleRate: 24000 });
    return;
  }

  if (req.method === "POST" && req.url === "/generate") {
    try {
      const { items = [], voice = DEFAULT_VOICE, speed = 1 } = await readBody(req);
      if (!Array.isArray(items) || !items.length) { json(res, 400, { error: "No items." }); return; }
      const model = await engine();
      const results = [];
      const failed = [];
      for (const item of items) {
        try {
          const out = await model.generate(String(item.text || ""), { voice, speed });
          const mp3 = encodeMp3(out.audio, out.sampling_rate);
          results.push({ id: item.id, mp3: mp3.toString("base64"), seconds: Number((out.audio.length / out.sampling_rate).toFixed(1)) });
        } catch (e) {
          failed.push({ id: item.id, error: String(e?.message || e).slice(0, 200) });
        }
      }
      json(res, 200, { results, failed });
    } catch (e) {
      json(res, 500, { error: String(e?.message || e).slice(0, 200) });
    }
    return;
  }

  json(res, 404, { error: "Unknown endpoint." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Wikido voiceover bridge listening on http://localhost:${PORT}`);
  console.log(`Engine: Kokoro-82M · default voice: ${DEFAULT_VOICE}`);
  console.log("Leave this running while you curate in the Wikido Studio.");
});
