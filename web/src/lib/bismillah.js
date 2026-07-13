// The verified Quran source (Uthmani mushaf convention) embeds the Bismillah in
// the Arabic text of a surah's first ayah for every surah except Al-Fatihah
// (whose real ayah 1 IS the Bismillah) and At-Tawbah (which opens with no
// Bismillah at all). Translations/transliterations do NOT include it. These
// helpers peel the Bismillah off so the reading view can show it as its own
// centered line, separate from the ayah it's textually fused to.

// Arabic combining diacritics (harakat/tashkeel), stripped before comparing
// words so voweled and unvoweled renderings both match. Covers Quranic
// annotation signs, the standard harakat block, superscript alef, and Quranic
// small high marks.
const DIACRITICS_RE = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const BISMILLAH_BARE_WORDS = ["بسم", "الله", "الرحمن", "الرحيم"];

function normalizeArabicWord(w) {
  return String(w || "")
    .replace(DIACRITICS_RE, "")
    .replace(/[ٱإأآ]/g, "ا") // alef wasla/hamza variants -> bare alef
    .trim();
}

function isBismillahPrefix(tokens) {
  // Strictly more than the four Bismillah words -- if the ayah IS just those
  // four words (Al-Fatihah's real ayah 1), nothing would remain after
  // splitting, so leave it alone.
  return tokens.length > BISMILLAH_BARE_WORDS.length &&
    BISMILLAH_BARE_WORDS.every((ref, i) => normalizeArabicWord(tokens[i]) === ref);
}

// Split a leading Bismillah off an ayah's word list (each { arabic, ... }).
export function splitBismillahWords(words) {
  const list = Array.isArray(words) ? words : [];
  if (!isBismillahPrefix(list.map((w) => w?.arabic))) return { bismillahWords: [], verseWords: list };
  return { bismillahWords: list.slice(0, BISMILLAH_BARE_WORDS.length), verseWords: list.slice(BISMILLAH_BARE_WORDS.length) };
}

// Same split for when only the plain Arabic string is available (no word list).
export function splitBismillahText(arabic) {
  const text = String(arabic || "").trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!isBismillahPrefix(tokens)) return { bismillah: "", verse: text };
  return {
    bismillah: tokens.slice(0, BISMILLAH_BARE_WORDS.length).join(" "),
    verse: tokens.slice(BISMILLAH_BARE_WORDS.length).join(" "),
  };
}
