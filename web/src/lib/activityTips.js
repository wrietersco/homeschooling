// Helpers for the parent-facing "tips" activity kind (Tips / Watch for /
// Encourage). Kept as a pure module — no Vue, no DOM — so the section-building
// and audio-id logic can be unit-tested in isolation and reused by the
// ActivityContent renderer.

// The family's native language. Parent facilitation guidance (tips) is written
// in this language, so its audio + Nastaliq font default to it unless the
// content explicitly tags another language.
export const NATIVE_LANG = "ur";

// The three tip sections, in display order. Each renders as its own block with
// a line-by-line 🔊 button and a "Play section" control.
export const TIP_SECTIONS = [
  { key: "tips", icon: "💡", title: "Tips" },
  { key: "watchFor", icon: "👀", title: "Watch for" },
  { key: "encourage", icon: "🌟", title: "Encourage" },
];

// The BCP-47 language of the tips text. Tips carry no per-line lang, so fall
// back to the family's native language (Urdu) unless the payload tags one.
export function tipsLangFor(tips, fallback = NATIVE_LANG) {
  return (tips && typeof tips.lang === "string" && tips.lang) || fallback;
}

// Build the non-empty tip sections from a `tips` payload, each carrying its
// cleaned (non-blank) line items. Sections with no lines are dropped so the UI
// never renders an empty block or an audio button with nothing to play.
export function buildTipsSections(tips) {
  const t = tips || {};
  return TIP_SECTIONS
    .map((s) => ({
      ...s,
      items: (Array.isArray(t[s.key]) ? t[s.key] : [])
        .filter((line) => typeof line === "string" && line.trim().length > 0),
    }))
    .filter((s) => s.items.length > 0);
}

// Stable id for a single tip line's audio. Matches the SpeakButton speakId
// format (`lang:voiceName:text`, voiceName empty) so a standalone line button
// and the "Play section" sequence light up the SAME line while it speaks.
export function tipLineId(lang, text) {
  return `${lang}::${text}`;
}

// Turn a section's items into the turn list speakSequence() expects, so the
// whole section can be read aloud in order.
export function tipSequence(lang, items, { rate = 0.95 } = {}) {
  return (items || []).map((text) => ({
    text,
    lang,
    id: tipLineId(lang, text),
    rate,
  }));
}
