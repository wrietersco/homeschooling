// Self-test for the server-side Kokoro voice.
//
//   node scripts/kokoro-selftest.mjs --fetch   # one-time: download the q8
//                                              # model into models/kokoro from
//                                              # Hugging Face, then synthesize
//   node scripts/kokoro-selftest.mjs           # offline: use the bundled model
//
// The deployed function runs with the model bundled (--fetch is a developer
// machine step); this script exists so a failed deploy or a bad model file is
// diagnosable locally before shipping.
const fetchModel = process.argv.includes("--fetch");
const { createKokoroEngine } = await import("../lib/wikidoKokoro.js");
const [{ KokoroTTS }, { default: lamejs }] = await Promise.all([
  import("kokoro-js"),
  import("@breezystack/lamejs"),
]);

console.log(fetchModel ? "Loading Kokoro-82M (fetching the q8 weights from Hugging Face if missing)…" : "Loading Kokoro-82M from the bundled weights…");
const t0 = Date.now();
const engine = createKokoroEngine({ KokoroTTS, lamejs, allowRemote: fetchModel });
const { mp3Base64, seconds } = await engine.generate("Testing the server-side Kokoro voice.");
console.log(`ok: ${seconds.toFixed(1)}s clip, ${Math.floor(mp3Base64.length * 0.75).toLocaleString()} bytes of MP3, ${((Date.now() - t0) / 1000).toFixed(1)}s total`);
