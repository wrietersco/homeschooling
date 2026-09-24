// Preference codec for the Phonics Playground word-voice picker. The stored
// preference (localStorage "phonics-word-voice") is one of:
//   • "auto"                  — the recommended Gemini teacher voice (Leda),
//                               chosen to match the bundled phoneme clips
//   • "gemini|<voiceName>"    — a specific Gemini voice from the shared TTS
//                               voice catalog (e.g. "gemini|Puck")
//   • <speechSynthesis URI>   — an installed device voice
// The "gemini|" prefix can never collide with a voiceURI ("|" is not a
// character browsers put in them) and sorts/serializes as plain text.
export const GEMINI_TEACHER_VOICE = "Leda";
const GEMINI_PREFIX = "gemini|";

export function isGeminiVoicePref(pref) {
  return typeof pref === "string" && pref.startsWith(GEMINI_PREFIX) && pref.length > GEMINI_PREFIX.length;
}

export function geminiVoicePref(voiceName) {
  return GEMINI_PREFIX + voiceName;
}

export function geminiVoiceFromPref(pref) {
  return pref.slice(GEMINI_PREFIX.length);
}

// Resolve a stored preference into what speakWord should do with it. A stale
// device pick (voice since uninstalled) falls back to auto — the same silent
// fallback speakWord already had. A Gemini pick is honored as-is even before
// the catalog loads (the caller demotes it to "auto" once the catalog reports
// Gemini unconfigured, so it can never linger broken).
export function resolveWordVoice(pref, systemVoices = []) {
  if (isGeminiVoicePref(pref)) return { kind: "gemini", voiceName: geminiVoiceFromPref(pref) };
  if (pref && pref !== "auto") {
    const voice = (systemVoices || []).find((v) => v?.voiceURI === pref);
    if (voice) return { kind: "device", voice };
  }
  return { kind: "auto" };
}
