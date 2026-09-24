// Builds the Explore celebration sounds ONCE and saves them as static files in
// web/public/audio/celebrate/. Nothing is generated at runtime: the app only
// plays these saved files when the buddy celebrates a child's win.
//
//   • Voice clips are recorded with Gemini TTS, then transcribed back with a
//     text model so a mispronounced clip is caught before it ships.
//   • Clapping is synthesised (seeded, so rebuilding gives the same file).
//   • "Masha'Allah + clapping" mixes the two.
//
// Usage: GEMINI_API_KEY=… node scripts/buildCelebrationSounds.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY is not set."); process.exit(1); }

const RATE = 24000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../web/public/audio/celebrate");
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const CHECK_MODEL = "gemini-2.5-flash";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

const VOICE_CLIPS = [
  {
    file: "mashallah.wav", voice: "Sulafat", expect: /m[aā]\s*-?sh[aā]*'?\s*-?a?llah|ما\s*شاء\s*الله/i,
    text: "Say this joyfully and warmly, like a proud parent cheering their child, with correct Arabic pronunciation: Masha'Allah! Well done!",
  },
  {
    file: "barakallah.wav", voice: "Sulafat", expect: /bar[aā]k\s*-?allah|بارك\s*الله/i,
    text: "Say this joyfully and warmly, like a proud parent praising their child, with correct Arabic pronunciation: Barak Allahu feek! Amazing!",
  },
  {
    file: "cheer.wav", voice: "Puck", expect: /yay|you did it/i,
    text: "Cheer this out excitedly and happily, like a best friend celebrating: Yaaay! You did it!",
  },
];

// ── WAV helpers ──────────────────────────────────────────────────────────────
function toWav(float32) {
  const data = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
function pcm16ToFloat(buf) {
  const out = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 0x8000;
  return out;
}
function normalize(f, peak = 0.9) {
  let m = 0;
  for (const v of f) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < f.length; i++) f[i] = (f[i] / m) * peak;
  return f;
}
// Trim leading/trailing near-silence so the sound lands the instant confetti does.
function trimSilence(f, threshold = 0.01, padMs = 40) {
  const pad = Math.round((RATE * padMs) / 1000);
  let a = 0; while (a < f.length && Math.abs(f[a]) < threshold) a++;
  let b = f.length - 1; while (b > a && Math.abs(f[b]) < threshold) b--;
  return f.slice(Math.max(0, a - pad), Math.min(f.length, b + pad));
}

// ── Synthesised clapping ─────────────────────────────────────────────────────
// A small group clapping together in an excited rhythm. Too many clappers (or
// too-long claps) smear into a hiss that sounds like static, so each clap is
// modelled on a real one: a few rapid transients as the palms meet, then a
// short tail, band-passed around 1 kHz, with a little room reverb. Each person
// is slightly off the beat and has their own hand "tone". Seeded, so a rebuild
// produces the identical file.
function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// RBJ-cookbook band-pass, applied in place.
function bandpass(x, freq, q) {
  const w = (2 * Math.PI * freq) / RATE, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  const a0 = 1 + alpha, b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
function oneClap(rand, tone) {
  const len = Math.round(RATE * 0.12);
  const env = new Float32Array(len);
  // palms meet in 3 quick slaps ~7 ms apart, then the sound rings out briefly
  for (const [offMs, amp, tauMs] of [[0, 1, 2.2], [7, 0.8, 2.2], [14, 0.65, 2.5], [18, 0.5, 22]]) {
    const off = Math.round((RATE * offMs) / 1000), tau = (RATE * tauMs) / 1000;
    for (let i = off; i < len; i++) env[i] += amp * Math.exp(-(i - off) / tau);
  }
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = (rand() * 2 - 1) * env[i];
  return bandpass(x, tone, 1.3);
}
function reverb(x, mixGain = 0.22) {
  const out = Float32Array.from(x);
  for (const [ms, g] of [[29, 0.5], [37, 0.45], [53, 0.4], [71, 0.3]]) {
    const d = Math.round((RATE * ms) / 1000);
    const comb = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) comb[i] = x[i] + (i >= d ? comb[i - d] * g : 0);
    for (let i = 0; i < x.length; i++) out[i] += comb[i] * mixGain * 0.25;
  }
  return out;
}
function applause(seconds = 2.8, clappers = 5, seed = 11) {
  const rand = mulberry32(seed);
  const n = Math.round(RATE * seconds);
  const out = new Float32Array(n);
  const beat = 1 / 4.4; // an excited "clap-clap-clap" tempo
  for (let c = 0; c < clappers; c++) {
    const tone = 850 + rand() * 900; // each person's hands sound a little different
    const lateness = rand() * 0.025; // nobody is exactly on the beat
    const loud = 0.6 + rand() * 0.4;
    for (let t = rand() * 0.04; t < seconds - 0.12; t += beat) {
      const clap = oneClap(rand, tone * (0.95 + rand() * 0.1));
      const start = Math.round((t + lateness + (rand() - 0.5) * 0.012) * RATE);
      const amp = loud * (0.8 + rand() * 0.2);
      for (let i = 0; i < clap.length && start + i < n; i++) out[start + i] += clap[i] * amp;
    }
  }
  const wet = reverb(out);
  // the group gets going quickly and trails off at the end
  for (let i = 0; i < n; i++) {
    const s = i / RATE;
    wet[i] *= Math.min(1, 0.55 + s / 0.4) * Math.min(1, (seconds - s) / 0.7);
  }
  return normalize(wet, 0.85);
}

// Voice first; the clapping swells in as the voice finishes, so neither masks
// the other (claps sit right in the speech band).
function mix(voice, bed, bedGain = 0.8, overlapSec = 0.5) {
  const offset = Math.max(0, voice.length - Math.round(RATE * overlapSec));
  const out = new Float32Array(Math.max(voice.length, offset + bed.length));
  for (let i = 0; i < out.length; i++) out[i] = (voice[i] || 0) + (i >= offset ? bed[i - offset] || 0 : 0) * bedGain;
  return normalize(out, 0.9);
}

// ── Gemini calls ─────────────────────────────────────────────────────────────
async function tts(text, voice) {
  const r = await fetch(`${API}/${TTS_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  const j = await r.json();
  const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error(`TTS failed: ${JSON.stringify(j).slice(0, 300)}`);
  return pcm16ToFloat(Buffer.from(b64, "base64"));
}

async function transcribe(wav) {
  const r = await fetch(`${API}/${CHECK_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
        { text: "Transcribe exactly what is said in this audio, using Latin letters for any Arabic words. Reply with the transcript only." },
      ] }],
    }),
  });
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}

async function describe(wav, question = "In one sentence: what kind of sound is this (e.g. speech, applause/clapping, music, static noise)? Describe what you hear.") {
  const r = await fetch(`${API}/${CHECK_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
        { text: question },
      ] }],
    }),
  });
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}

// ── Build ────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
let failed = false;
const clap = applause();
const clapWav = toWav(clap);
// Synthesis can easily come out sounding like static — have a model listen.
const clapHeard = await describe(clapWav);
const clapOk = /clap|applau/i.test(clapHeard) && !/static|interference|buzz/i.test(clapHeard);
console.log(`clapping.wav          ${(clap.length / RATE).toFixed(2)}s (synthesised)  heard: "${clapHeard}"  ${clapOk ? "OK" : "MISMATCH"}`);
if (clapOk) writeFileSync(join(OUT, "clapping.wav"), clapWav);
else failed = true;

const voices = {};
for (const clip of VOICE_CLIPS) {
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const audio = trimSilence(normalize(await tts(clip.text, clip.voice)), 0.006, 150);
    const wav = toWav(audio);
    const heard = await transcribe(wav);
    ok = clip.expect.test(heard);
    console.log(`${clip.file.padEnd(22)}${(audio.length / RATE).toFixed(2)}s  heard: "${heard}"  ${ok ? "OK" : `MISMATCH (try ${attempt})`}`);
    if (ok) { writeFileSync(join(OUT, clip.file), wav); voices[clip.file] = audio; }
  }
  if (!ok) failed = true;
}

if (voices["mashallah.wav"] && clapOk) {
  const combo = mix(voices["mashallah.wav"], applause(2.2));
  const comboWav = toWav(combo);
  const heard = await describe(comboWav, "Answer on one line in exactly this form: SPEECH: yes/no (what is said); CLAPPING: yes/no");
  const ok = /SPEECH:\s*yes/i.test(heard) && /CLAPPING:\s*yes/i.test(heard);
  console.log(`mashallah-clap.wav    ${(combo.length / RATE).toFixed(2)}s (mix)  heard: "${heard}"  ${ok ? "OK" : "MISMATCH"}`);
  if (ok) writeFileSync(join(OUT, "mashallah-clap.wav"), comboWav);
  else failed = true;
}
process.exit(failed ? 1 : 0);
