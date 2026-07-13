// The first sentence of `text`, for a fast/cheap TTS voice sample instead of
// synthesizing an entire paragraph. Falls back to the whole text when no
// sentence-ending punctuation is found (already a single short phrase), and
// caps runaway "sentences" (no punctuation for a long stretch) at a word
// boundary so a preview never balloons into a full-paragraph call. Recognizes
// Arabic (؟) and Urdu (۔) sentence terminators alongside . ! ?
const MAX_PREVIEW_CHARS = 220;

export function firstSentence(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  const m = t.match(/^[\s\S]*?[.!?؟۔](?=\s|$)/);
  const sentence = m && m[0].trim() ? m[0].trim() : t;
  if (sentence.length <= MAX_PREVIEW_CHARS) return sentence;
  const cut = sentence.slice(0, MAX_PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
