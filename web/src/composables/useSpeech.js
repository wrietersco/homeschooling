// Text-to-speech for the activity player. A tap on any word, sentence, or
// paragraph reads it aloud. Quality voice comes from the Gemini TTS Cloud
// Function (professional multilingual audio, incl. Arabic) which is cached and
// played as recorded audio; the browser SpeechSynthesis API is the offline /
// signed-out fallback. Real Quran qirat uses recorded MP3s via playAudio().
import { ref } from "vue";
import { auth } from "@/lib/firebase";
import { synthesizeSpeech } from "@/services/tts";

const supported = ref(typeof window !== "undefined" && "speechSynthesis" in window);
const speakingId = ref(null); // id of the currently-speaking chunk, for UI highlight
const loadingId = ref(null);  // id of the chunk whose Gemini audio is being fetched
const sequenceIndex = ref(-1); // index of the turn currently playing in a scene, or -1
let sequenceToken = 0;         // bumped on stop()/new sequence to cancel a running chain
const lastError = ref("");     // last TTS error message (for diagnostics)
const ttsLogs = ref([]);       // recent TTS events, newest first (diagnostics on request)
let voices = [];
let activeAudio = null; // currently-playing recorded-audio element (qirat, etc.)

// ─── Mobile audio unlock ─────────────────────────────────────────────────────
// iOS Safari and Android Chrome refuse to play audio (and speak) until a user
// gesture has "unlocked" the page — and a tapped word always plays AFTER an
// async server round-trip, i.e. outside the gesture's call stack, so on phones
// the first tap on every word would be silent while the same tap works on
// desktop. The first gesture anywhere primes both audio systems synchronously
// (capture-phase listener, so it runs before the tap's own handler): a silent
// <audio> element is played once inside the gesture, and a silent utterance
// primes speech synthesis. After that, the async TTS → play() chain is allowed.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
let audioUnlocked = false;
let unlockEl = null;

function unlockSpeechAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    if (!unlockEl) {
      unlockEl = new Audio(SILENT_WAV);
      unlockEl.preload = "auto";
    }
    const p = unlockEl.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch { /* no <audio> support — speechSynthesis prime below still helps */ }
  try {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (synth) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    }
  } catch { /* ignore — desktop browsers don't need the prime */ }
}

// Exported for tests + audio diagnostics: has a gesture unlocked audio yet?
export function isSpeechAudioUnlocked() {
  return audioUnlocked;
}

if (typeof window !== "undefined") {
  const GESTURES = ["pointerdown", "touchstart", "touchend", "click"];
  const onFirstGesture = () => {
    unlockSpeechAudio();
    for (const evt of GESTURES) window.removeEventListener(evt, onFirstGesture, true);
  };
  for (const evt of GESTURES) {
    window.addEventListener(evt, onFirstGesture, { capture: true, passive: true });
  }
}

// Friendly names for the non-English languages we read aloud, for the
// "no on-device voice" notice (most desktops ship no Arabic/Urdu voice).
const LANG_NAMES = { ar: "Arabic", ur: "Urdu", fa: "Persian", ps: "Pashto" };

function logTts(msg) {
  ttsLogs.value = [msg, ...ttsLogs.value].slice(0, 25);
}

// In-memory cache of synthesized audio URLs, keyed by `voice|lang|text`, so a
// repeated tap on the same chunk replays instantly without another round-trip.
const serverAudioCache = new Map();
// Set once the server reports it cannot synthesize at all this session (e.g. the
// Cloud Function is unconfigured). We deliberately do NOT blacklist individual
// texts on a thrown error: a one-off timeout / rate-limit / 5xx used to poison a
// word permanently, so it could never be spoken again no matter how many times
// it was tapped while its siblings worked. Transient failures now simply fall
// back to the browser voice for that one tap and retry the server next time.
let serverUnavailable = false;

function loadVoices() {
  if (!supported.value) return;
  voices = window.speechSynthesis.getVoices() || [];
}

if (supported.value) {
  loadVoices();
  // Voices load asynchronously in most browsers.
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// Pick the closest installed voice for a BCP-47 lang code (e.g. "ar", "ar-SA").
function pickVoice(lang) {
  if (!lang || !voices.length) return null;
  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  return (
    voices.find((v) => v.lang?.toLowerCase() === want) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(base + "-")) ||
    voices.find((v) => v.lang?.toLowerCase() === base) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ||
    null
  );
}

// Whether we actually have a voice for this language (UI can warn if not).
export function hasVoiceFor(lang) {
  if (!supported.value) return false;
  if (!voices.length) loadVoices();
  return Boolean(pickVoice(lang)) || voices.length > 0;
}

export function useSpeech() {
  // Cancel whatever is playing right now WITHOUT cancelling a running scene chain
  // (each turn calls this internally before starting the next one).
  function stopAudio() {
    if (supported.value) window.speechSynthesis.cancel();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.onended = activeAudio.onerror = null;
      activeAudio = null;
    }
    speakingId.value = null;
    loadingId.value = null;
  }

  // Public stop — also halts any in-flight scene chain (bumps the token so the
  // queued next() turns abort) and clears the scene highlight.
  function stop() {
    sequenceToken += 1;
    sequenceIndex.value = -1;
    stopAudio();
  }

  // Play a recorded audio file (real qirat / recitation). Falls back to onError
  // if the file can't load/play (offline, blocked, missing). id echoes into
  // speakingId for the active-highlight, like speak().
  function playAudio(url, { id = null, onError = null, onEnd = null } = {}) {
    if (!url) { if (onError) onError(); else if (onEnd) onEnd(); return; }
    unlockSpeechAudio(); // in-gesture prime if the global listener somehow missed this tap
    stopAudio();
    const a = new Audio(url);
    activeAudio = a;
    speakingId.value = id;
    const clear = () => { if (speakingId.value === id) speakingId.value = null; if (activeAudio === a) activeAudio = null; };
    a.onended = () => { clear(); if (onEnd) onEnd(); };
    a.onerror = () => { clear(); if (onError) onError(); else if (onEnd) onEnd(); };
    a.onplaying = () => { lastError.value = ""; }; // audio reached the speakers — no error to show
    a.play().catch(() => { clear(); if (onError) onError(); else if (onEnd) onEnd(); });
  }

  // Browser-native fallback voice. Picks the best installed voice for `lang`.
  function browserSpeak(text, lang = "en", { id = null, rate = 0.85, onEnd = null } = {}) {
    if (!supported.value || !text) { if (onEnd) onEnd(); return; }
    window.speechSynthesis.cancel();
    if (!voices.length) loadVoices();

    const voice = pickVoice(lang);
    // We only reach the browser voice once server TTS is unavailable/failed. If
    // there is also no installed voice for a non-English language (Arabic has
    // none on most desktops), the utterance would play SILENTLY with zero
    // feedback — the exact "tapping a qaida letter does nothing" symptom. Surface
    // it instead of pretending to speak, so the failure is visible and explained.
    const base = (lang || "").toLowerCase().split("-")[0];
    if (!voice && voices.length && base && base !== "en") {
      const name = LANG_NAMES[base] || base;
      lastError.value = `Couldn't play audio — no ${name} voice on this device, and online speech is unavailable right now. Try again, or check the Audio diagnostics below.`;
      logTts(`⚠ no on-device "${base}" voice; cannot speak "${text.slice(0, 24)}" offline`);
      if (speakingId.value === id) speakingId.value = null;
      if (onEnd) onEnd();
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en";
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = 1;
    u.onstart = () => { speakingId.value = id; lastError.value = ""; }; // speaking — clear any prior notice
    u.onend = () => { if (speakingId.value === id) speakingId.value = null; if (onEnd) onEnd(); };
    u.onerror = () => { if (speakingId.value === id) speakingId.value = null; if (onEnd) onEnd(); };
    window.speechSynthesis.speak(u);
  }

  // Try professional Gemini TTS (cached). Resolves true if it played, false if
  // the caller should fall back to the browser voice. Only attempted when signed
  // in (the Cloud Function is auth-scoped) and not previously failed for `text`.
  // `contentKind` (e.g. "quran", "story", "tips") picks a default emotional tone
  // fitting that kind of content server-side, so it's part of the cache key too
  // (the same text read for two different kinds is a genuinely different clip).
  // `provider`/`model` pin the synthesis backend for explicit voice picks (e.g.
  // the phonics word-voice picker choosing a specific Gemini voice) — without
  // them the platform-configured provider decides, which may not be Gemini.
  async function serverSpeak(text, lang, { id = null, voiceName = "", provider = "", model = "", contentKind = "", onEnd = null } = {}) {
    const key = `${provider || ""}|${model || ""}|${voiceName || ""}|${lang}|${contentKind || ""}|${text}`;
    if (serverAudioCache.has(key)) {
      playAudio(serverAudioCache.get(key), { id, onError: () => browserSpeak(text, lang, { id, onEnd }), onEnd });
      return true;
    }
    if (serverUnavailable || !auth.currentUser) return false;
    loadingId.value = id;  // drives the "preparing audio…" spinner on the button
    try {
      const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
      const res = await synthesizeSpeech({
        text,
        lang,
        voiceName: voiceName || undefined,
        provider: provider || undefined,
        model: model || undefined,
        contentKind: contentKind || undefined,
      });
      // Function reachable but not set up (no API key) — give up for the session.
      if (res && res.configured === false) {
        serverUnavailable = true;
        logTts(`⚠ speech synthesis isn't configured — using device voice`);
        return false;
      }
      if (res?.url) {
        serverAudioCache.set(key, res.url);
        logTts(`✓ "${text.slice(0, 24)}" (${lang}) ${res.cached ? "cached" : "synthesized"} in ${Math.round(((typeof performance !== "undefined" ? performance.now() : 0) - t0))}ms`);
        if (loadingId.value === id) loadingId.value = null;
        playAudio(res.url, { id, onError: () => browserSpeak(text, lang, { id, onEnd }), onEnd });
        return true;
      }
      logTts(`⚠ "${text.slice(0, 24)}" returned no audio — using device voice (will retry server next tap)`);
    } catch (e) {
      // Transient (timeout / rate-limit / network / 5xx): fall back for THIS tap
      // only, but do NOT blacklist — the next tap retries the server so a word is
      // never permanently muted by a one-off failure.
      lastError.value = String(e?.message || e);
      logTts(`✗ "${text.slice(0, 24)}" (${lang}): ${lastError.value} — using device voice (will retry server next tap)`);
    } finally {
      if (loadingId.value === id) loadingId.value = null;
    }
    return false;
  }

  // Internal speak that cancels current AUDIO only (not a running scene chain), so
  // it can be used both standalone and to play each turn of a sequence. `onEnd`
  // fires once when this utterance finishes (server audio, browser voice, or a
  // silent no-op). `voiceName` selects a Gemini voice (per-character in dialogue);
  // `provider`/`model` pin the backend for explicit voice picks.
  function _speak(text, lang = "en", { id = null, rate = 0.85, voiceName = "", provider = "", model = "", contentKind = "", onEnd = null } = {}) {
    if (!text) { if (onEnd) onEnd(); return; }
    stopAudio();
    serverSpeak(text, lang, { id, voiceName, provider, model, contentKind, onEnd }).then((ok) => {
      if (!ok) browserSpeak(text, lang, { id, rate, onEnd });
    });
  }

  // Public speak — also cancels any running scene chain (a single tap interrupts
  // a playing conversation). Gemini TTS first, browser voice as fallback.
  // `contentKind` (e.g. "quran", "story", "tips") picks a default emotional tone
  // fitting that kind of content — see TONE_BY_CONTENT_KIND server-side.
  function speak(text, lang = "en", { id = null, rate = 0.85, voiceName = "", provider = "", model = "", contentKind = "" } = {}) {
    if (!text) return;
    unlockSpeechAudio(); // synchronously inside the tap — async TTS later needs this on mobile
    lastError.value = ""; // fresh tap — clear any prior "couldn't be spoken" notice
    sequenceToken += 1;
    sequenceIndex.value = -1;
    _speak(text, lang, { id, rate, voiceName, provider, model, contentKind });
  }

  // Play a list of turns in order, each with its own voice. `turns` items:
  // { text, lang, voiceName, rate, contentKind, audioUrl }. A turn carrying
  // `audioUrl` (a parent's saved custom voice for that exact line) plays that
  // recording instead of synthesizing — falling back to TTS if it can't load —
  // so "play the whole thing" actually uses the same per-line voices a parent
  // picked and saved, not just a single tapped line. `sequenceIndex` tracks the
  // active turn for UI highlight; stop() (or any standalone speak) cancels the chain.
  function speakSequence(turns = []) {
    stop();
    const myToken = sequenceToken;
    let i = 0;
    const next = () => {
      if (myToken !== sequenceToken) return; // superseded by a newer stop()/sequence
      if (i >= turns.length) { sequenceIndex.value = -1; return; }
      const t = turns[i];
      const cur = i;
      i += 1;
      sequenceIndex.value = cur;
      const speakTurn = () => _speak(t.text, t.lang || "en", { id: t.id, voiceName: t.voiceName, provider: t.provider, model: t.model, contentKind: t.contentKind, rate: t.rate ?? 0.95, onEnd: next });
      if (t.audioUrl) playAudio(t.audioUrl, { id: t.id, onError: speakTurn, onEnd: next });
      else speakTurn();
    };
    next();
  }

  return { supported, speakingId, loadingId, sequenceIndex, lastError, ttsLogs, speak, speakSequence, browserSpeak, playAudio, stop, hasVoiceFor };
}
