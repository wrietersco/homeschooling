// Shared plumbing for per-element saved-voice overrides.
//
// ActivityContent `provide()`s a context under TTS_OVERRIDES; SpeakButton (and the
// Qaida glyph tiles) `inject()` it. The context shape:
//   { overrideFor(text, lang) -> { url, provider, model, voiceName } | null,
//     canEditVoice: boolean,
//     saveOverride(text, lang, { url, provider, model, voiceName }) -> void }
// Absent context ⇒ no picker and default playback (back-compat for any other caller).
export const TTS_OVERRIDES = Symbol("ttsOverrides");

// Stable key for an element's saved voice: language + normalized (NFC, trimmed) text.
// Two elements with the same spoken text+lang intentionally share one saved voice.
export function overrideKey(text, lang) {
  return `${lang || "en"}|${String(text || "").normalize("NFC").trim()}`;
}
