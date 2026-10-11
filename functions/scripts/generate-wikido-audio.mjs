// Wikido audio pre-generation — the developer-environment half of Wikido audio.
//
// Narration and hotspot cards are synthesized ONCE with Kokoro TTS (local,
// offline, high quality) and shipped as MP3s next to the artwork, so children
// get instant playback with zero network waiting. The runtime prefers these
// recordings (SpeakButton audioUrl → playAudio) and only falls back to the
// Gemini TTS cloud function / on-device voice when a clip is missing.
//
//   cd functions
//   node scripts/generate-wikido-audio.mjs                  # all missing clips
//   node scripts/generate-wikido-audio.mjs --force          # re-synthesize everything
//   node scripts/generate-wikido-audio.mjs --scene tachara  # one scene
//   node scripts/generate-wikido-audio.mjs --voice af_bella # different narrator
//
// For every scene the script:
//   1. speaks `"<scene.title>. <scene.narration>"` (exactly what the UI's
//      "Read to me" button reads),
//   2. for each hotspot speaks the info card text exactly as the UI composes
//      it: `title + body[] + "Fun fact! <fact>"`,
//   3. writes web/public/wikido/<topicId>/audio/<sceneId>[.<hotspotId>].mp3, and
//   4. patches the pack's `audio:` fields.
//
// IMPORTANT: if you change narration/info wording in a pack, re-run this script
// (--force or per scene) so recordings stay in sync with the text on screen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import lamejs from "@breezystack/lamejs";
import { KokoroTTS } from "kokoro-js";
import { wikidoTopicPacks } from "../../web/src/lib/wikido/index.js";

const args = process.argv.slice(2);
function argOf(name, fallback = "") {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const hasFlag = (name) => args.includes(name);
const onlyTopic = argOf("--topic");
const onlyScene = argOf("--scene");
const onlyHotspot = argOf("--hotspot");
const voice = argOf("--voice", "af_heart");
const speed = Number(argOf("--speed", "1")) || 1;
const force = hasFlag("--force");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const audioDir = path.join(root, "web", "public", "wikido");

const SAMPLE_RATE = 24000;
const KBPS = 80;

// Same spoken text the UI composes — keep in sync with WikidoScene.narrated and
// WikidoInfoCard.spoken.
const narrationText = (scene) => `${scene.title}. ${scene.narration}`;
const hotspotText = (spot) =>
  [spot.info.title, ...spot.info.body, spot.info.fact ? `Fun fact! ${spot.info.fact}` : ""]
    .filter(Boolean)
    .join(" ");

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

// ── Pack patching ─────────────────────────────────────────────────────────────
// Inserts `audio: "<path>",` into the pack: scene-level before its `hotspots:`
// line, hotspot-level before its `info: {` line. Anchors are structural so a
// scene id that also appears as a hotspot id elsewhere (e.g. "bull-capitals")
// can never hijack the insertion point:
//   scene keys are the only 4-space-indented quoted keys, and hotspot id lines
//   carry exactly 10 spaces of indentation.
function patchPack(pack, sceneId, hotspotId, audioPath) {
  const packFile = path.join(root, "web", "src", "lib", "wikido", "topics", `${pack.id}.js`);
  let text = readFileSync(packFile, "utf8");
  const sceneIdx = text.indexOf(`\n    "${sceneId}": {`);
  if (sceneIdx < 0) return false;
  const sceneEnd = text.indexOf(`\n    "`, sceneIdx + 10);
  const sceneStop = sceneEnd < 0 ? text.length : sceneEnd;

  if (!hotspotId) {
    if (text.slice(sceneIdx, sceneStop).includes("audio:")) return false;
    const anchor = text.indexOf("hotspots: [", sceneIdx);
    if (anchor < 0 || anchor > sceneStop) return false;
    const lineStart = text.lastIndexOf("\n", anchor);
    text = text.slice(0, lineStart) + `\n      audio: "${audioPath}",` + text.slice(lineStart);
  } else {
    const spotMarker = `\n          id: "${hotspotId}",`;
    const spotIdx = text.indexOf(spotMarker, sceneIdx);
    if (spotIdx < 0 || spotIdx > sceneStop) return false;
    // the hotspot's own block ends where the next hotspot begins — never let a
    // later sibling's audio line make this one think it's already wired
    const nextSpot = text.indexOf(`\n          id: "`, spotIdx + 10);
    const spotStop = nextSpot < 0 || nextSpot > sceneStop ? sceneStop : nextSpot;
    if (text.slice(spotIdx, spotStop).includes("audio:")) return false;
    const infoIdx = text.indexOf("info: {", spotIdx);
    if (infoIdx < 0 || infoIdx > spotStop) return false;
    const lineStart = text.lastIndexOf("\n", infoIdx);
    text = text.slice(0, lineStart) + `\n          audio: "${audioPath}",` + text.slice(lineStart);
  }
  writeFileSync(packFile, text);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const packs = wikidoTopicPacks.filter((p) => !onlyTopic || p.id === onlyTopic);
if (!packs.length) {
  console.error(`No topic pack matches --topic ${onlyTopic}`);
  process.exit(1);
}

const jobs = [];
for (const pack of packs) {
  for (const scene of Object.values(pack.scenes)) {
    if (onlyScene && scene.id !== onlyScene) continue;
    jobs.push({ pack, scene, spot: null, text: narrationText(scene), file: `${scene.id}.mp3` });
    for (const spot of scene.hotspots) {
      if (onlyHotspot && spot.id !== onlyHotspot) continue;
      jobs.push({ pack, scene, spot, text: hotspotText(spot), file: `${scene.id}.${spot.id}.mp3` });
    }
  }
}
if (hasFlag("--list")) {
  for (const j of jobs) console.log(`${j.file}  (${Math.round(j.text.length / 5)}s est)`);
  process.exit(0);
}

const pending = force ? jobs : jobs.filter((j) => !existsSync(path.join(audioDir, j.pack.id, "audio", j.file)));
console.log(`${jobs.length} clips total, ${jobs.length - pending.length} already present, ${pending.length} to synthesize (voice: ${voice}, speed: ${speed}).`);

let ok = 0;
let failed = 0;
let patched = 0;
if (pending.length) {
  console.log("Loading Kokoro-82M (first run downloads ~90 MB from Hugging Face)…");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
  console.log("Model ready.");
  for (const [i, job] of pending.entries()) {
    const outDir = path.join(audioDir, job.pack.id, "audio");
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, job.file);
    try {
      const t0 = Date.now();
      const result = await tts.generate(job.text, { voice, speed });
      const samples = result.audio;
      const seconds = samples.length / result.sampling_rate;
      const mp3 = encodeMp3(samples, result.sampling_rate);
      writeFileSync(outFile, mp3);
      ok += 1;
      console.log(`✓ [${i + 1}/${pending.length}] ${job.file} — ${seconds.toFixed(1)}s, ${Math.round(mp3.length / 1024)} KB (${Date.now() - t0}ms)`);
    } catch (err) {
      failed += 1;
      console.error(`✗ [${i + 1}/${pending.length}] ${job.file}: ${err?.message || err}`);
    }
  }
}

// Wire the pack references for every clip that exists (new or pre-existing), so
// an interrupted run — or one with nothing left to synthesize — always leaves
// the pack fully healed before it exits.
for (const job of jobs) {
  const file = path.join(audioDir, job.pack.id, "audio", job.file);
  if (!existsSync(file)) continue;
  if (patchPack(job.pack, job.scene.id, job.spot?.id || null, `/wikido/${job.pack.id}/audio/${job.file}`)) patched += 1;
}

console.log(`\nDone: ${ok} generated, ${failed} failed, ${patched} pack references wired. Review a few clips, then commit the audio + pack changes.`);
