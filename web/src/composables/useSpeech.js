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
    stopAudio();
    const a = new Audio(url);
    activeAudio = a;
    speakingId.value = id;
    const clear = () => { if (speakingId.value === id) speakingId.value = null; if (activeAudio === a) activeAudio = null; };
    a.onended = () => { clear(); if (onEnd) onEnd(); };
    a.onerror = () => { clear(); if (onError) onError(); else if (onEnd) onEnd(); };
    a.play().catch(() => { clear(); if (onError) onError(); else if (onEnd) onEnd(); });
  }

  // Browser-native fallback voice. Picks the best installed voice for `lang`.
  function browserSpeak(text, lang = "en", { id = null, rate = 0.85, onEnd = null } = {}) {
    if (!supported.value || !text) { if (onEnd) onEnd(); return; }
    window.speechSynthesis.cancel();
    if (!voices.length) loadVoices();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en";
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = 1;
    u.onstart = () => { speakingId.value = id; };
    u.onend = () => { if (speakingId.value === id) speakingId.value = null; if (onEnd) onEnd(); };
    u.onerror = () => { if (speakingId.value === id) speakingId.value = null; if (onEnd) onEnd(); };
    window.speechSynthesis.speak(u);
  }

  // Try professional Gemini TTS (cached). Resolves true if it played, false if
  // the caller should fall back to the browser voice. Only attempted when signed
  // in (the Cloud Function is auth-scoped) and not previously failed for `text`.
  async function serverSpeak(text, lang, { id = null, voiceName = "", onEnd = null } = {}) {
    const key = `${voiceName || ""}|${lang}|${text}`;
    if (serverAudioCache.has(key)) {
      playAudio(serverAudioCache.get(key), { id, onError: () => browserSpeak(text, lang, { id, onEnd }), onEnd });
      return true;
    }
    if (serverUnavailable || !auth.currentUser) return false;
    loadingId.value = id;  // drives the "preparing audio…" spinner on the button
    try {
      const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
      const res = await synthesizeSpeech({ text, lang, voiceName: voiceName || undefined });
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
  // silent no-op). `voiceName` selects a Gemini voice (per-character in dialogue).
  function _speak(text, lang = "en", { id = null, rate = 0.85, voiceName = "", onEnd = null } = {}) {
    if (!text) { if (onEnd) onEnd(); return; }
    stopAudio();
    serverSpeak(text, lang, { id, voiceName, onEnd }).then((ok) => {
      if (!ok) browserSpeak(text, lang, { id, rate, onEnd });
    });
  }

  // Public speak — also cancels any running scene chain (a single tap interrupts
  // a playing conversation). Gemini TTS first, browser voice as fallback.
  function speak(text, lang = "en", { id = null, rate = 0.85, voiceName = "" } = {}) {
    if (!text) return;
    sequenceToken += 1;
    sequenceIndex.value = -1;
    _speak(text, lang, { id, rate, voiceName });
  }

  // Play a list of turns in order, each with its own voice. `turns` items:
  // { text, lang, voiceName, rate }. `sequenceIndex` tracks the active turn for
  // UI highlight; stop() (or any standalone speak) cancels the chain.
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
      _speak(t.text, t.lang || "en", { id: t.id, voiceName: t.voiceName, rate: t.rate ?? 0.95, onEnd: next });
    };
    next();
  }

  return { supported, speakingId, loadingId, sequenceIndex, lastError, ttsLogs, speak, speakSequence, browserSpeak, playAudio, stop, hasVoiceFor };
}
