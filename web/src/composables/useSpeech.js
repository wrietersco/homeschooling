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
let voices = [];
let activeAudio = null; // currently-playing recorded-audio element (qirat, etc.)

// In-memory cache of synthesized audio URLs, keyed by `voice|lang|text`, so a
// repeated tap on the same chunk replays instantly without another round-trip.
const serverAudioCache = new Map();
// Texts we've already tried and failed to synthesize on the server, so we skip
// straight to the browser voice next time instead of re-failing.
const serverFailed = new Set();

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
  function stop() {
    if (supported.value) window.speechSynthesis.cancel();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.onended = activeAudio.onerror = null;
      activeAudio = null;
    }
    speakingId.value = null;
  }

  // Play a recorded audio file (real qirat / recitation). Falls back to onError
  // if the file can't load/play (offline, blocked, missing). id echoes into
  // speakingId for the active-highlight, like speak().
  function playAudio(url, { id = null, onError = null } = {}) {
    if (!url) { if (onError) onError(); return; }
    stop();
    const a = new Audio(url);
    activeAudio = a;
    speakingId.value = id;
    const clear = () => { if (speakingId.value === id) speakingId.value = null; if (activeAudio === a) activeAudio = null; };
    a.onended = clear;
    a.onerror = () => { clear(); if (onError) onError(); };
    a.play().catch(() => { clear(); if (onError) onError(); });
  }

  // Browser-native fallback voice. Picks the best installed voice for `lang`.
  function browserSpeak(text, lang = "en", { id = null, rate = 0.85 } = {}) {
    if (!supported.value || !text) return;
    window.speechSynthesis.cancel();
    if (!voices.length) loadVoices();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en";
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = 1;
    u.onstart = () => { speakingId.value = id; };
    u.onend = () => { if (speakingId.value === id) speakingId.value = null; };
    u.onerror = () => { if (speakingId.value === id) speakingId.value = null; };
    window.speechSynthesis.speak(u);
  }

  // Try professional Gemini TTS (cached). Resolves true if it played, false if
  // the caller should fall back to the browser voice. Only attempted when signed
  // in (the Cloud Function is auth-scoped) and not previously failed for `text`.
  async function serverSpeak(text, lang, { id = null } = {}) {
    const key = `${lang}|${text}`;
    if (serverAudioCache.has(key)) {
      playAudio(serverAudioCache.get(key), { id, onError: () => browserSpeak(text, lang, { id }) });
      return true;
    }
    if (serverFailed.has(key) || !auth.currentUser) return false;
    try {
      const res = await synthesizeSpeech({ text, lang });
      if (res?.url) {
        serverAudioCache.set(key, res.url);
        playAudio(res.url, { id, onError: () => browserSpeak(text, lang, { id }) });
        return true;
      }
    } catch {
      serverFailed.add(key);
    }
    return false;
  }

  // Speak `text` in `lang`. Gemini TTS first (professional, multilingual),
  // browser voice as fallback. `id` highlights the active chunk; `rate` only
  // affects the browser fallback (Gemini speaks at a natural pace).
  function speak(text, lang = "en", { id = null, rate = 0.85 } = {}) {
    if (!text) return;
    stop();
    serverSpeak(text, lang, { id }).then((ok) => {
      if (!ok) browserSpeak(text, lang, { id, rate });
    });
  }

  return { supported, speakingId, speak, browserSpeak, playAudio, stop, hasVoiceFor };
}
