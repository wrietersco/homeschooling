// Audio plumbing for the Gemini Live conversation. Gemini wants 16 kHz mono
// 16-bit little-endian PCM in (base64) and sends 24 kHz PCM16 back. Everything
// here is pure so it can be unit-tested without a microphone.

export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;

// Downsample float32 mic samples (any rate) to `toRate` by averaging the source
// samples that fall into each output sample (a cheap box filter that avoids the
// worst aliasing of plain decimation).
export function downsample(input, fromRate, toRate = INPUT_RATE) {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(int16) {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// mic float32 @ fromRate → base64 PCM16 @16k, ready for sendRealtimeInput.
export function micChunkToBase64(float32, fromRate) {
  const pcm = floatToPcm16(downsample(float32, fromRate, INPUT_RATE));
  return bytesToBase64(new Uint8Array(pcm.buffer));
}

// base64 PCM16 @24k from Gemini → float32 samples for an AudioBuffer.
export function base64ToFloat(b64) {
  const bytes = base64ToBytes(b64);
  return pcm16ToFloat(new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)));
}

// Root-mean-square loudness 0..1 (drives the buddy's mouth / listening glow).
export function rms(float32) {
  if (!float32.length) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

// A short, cheerful ascending chime for the on-screen celebration effect — a
// synthesized jingle (no bundled audio file, no AI generation) so it plays
// instantly on the buddy's own AudioContext. The note data is pure so its
// shape is unit-tested; scheduling the oscillators needs a real AudioContext.
export const CELEBRATION_NOTES = [
  { freq: 523.25, start: 0, dur: 0.16 }, // C5
  { freq: 659.25, start: 0.12, dur: 0.16 }, // E5
  { freq: 783.99, start: 0.24, dur: 0.16 }, // G5
  { freq: 1046.5, start: 0.36, dur: 0.34 }, // C6
];

// Seconds from the first note's start to the last note's release.
export const CELEBRATION_CHIME_SECONDS = Math.max(...CELEBRATION_NOTES.map((n) => n.start + n.dur)) + 0.05;

// `when` (AudioContext time) lets the chime be queued behind the buddy's voice.
export function playCelebrationChime(ctx, when) {
  if (!ctx) return;
  const now = Math.max(ctx.currentTime, when || 0);
  for (const { freq, start, dur } of CELEBRATION_NOTES) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.25, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  }
}

// SAFETY NET for the celebration effect: the Live model is told to call the
// `celebrate` tool whenever it praises a correct answer, but a real session
// showed it can say the praise ("That is exactly right, Abdul Hadi!") and
// forget the tool call. Since the buddy's own transcribed speech already
// signals a genuine win, this scans it for the same phrases the prompt asks
// the model to pair with the tool call, so the confetti+chime still fire.
// Compound phrases (not bare words like "right") are used deliberately: they
// double as their own negation guard — "that's NOT right" doesn't match
// `that's right` because "not" breaks the adjacency — except the two isolated
// patterns below, which get an explicit negation check.
const CELEBRATION_PHRASES = [
  /exactly right/i,
  /completely right/i,
  /that'?s\s+(so\s+)?right/i,
  /you'?re\s+right/i,
  /you\s+did\s+it/i,
  /you\s+got\s+it(\s+right)?/i,
  /you\s+nailed\s+(it|both|that)/i,
  /did\s+(that|it)\s+perfectly/i,
  /you\s+spelled\s+\S+\s+(completely\s+)?right/i,
  /well\s+done/i,
  /great\s+job/i,
  /amazing\s+job/i,
  /fantastic\s+job/i,
  /correct!/i, // isolated — guarded below
  /100\s*%/, // isolated — guarded below
];
const CELEBRATION_NEGATORS = /\b(not|n't|isn'?t|wasn'?t|aren'?t|weren'?t|almost|nearly)\b/i;

export function looksLikeCelebration(text) {
  const t = String(text || "");
  if (!t) return false;
  for (const re of CELEBRATION_PHRASES) {
    const m = t.match(re);
    if (!m) continue;
    const before = t.slice(Math.max(0, m.index - 20), m.index);
    if (CELEBRATION_NEGATORS.test(before)) continue;
    return true;
  }
  return false;
}

// Merge streaming transcript fragments into a running list of turns. Gemini
// sends transcription in small pieces per speaker; consecutive pieces from the
// same role extend the last turn.
export function appendTranscript(turns, role, text) {
  if (!text) return turns;
  const last = turns[turns.length - 1];
  if (last && last.role === role) {
    return [...turns.slice(0, -1), { role, text: last.text + text }];
  }
  return [...turns, { role, text }];
}
