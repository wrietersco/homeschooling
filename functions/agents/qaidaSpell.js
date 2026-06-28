// Noorani Qaida spell-out engine — PURE, deterministic, no LLM.
//
// The Qaida teaches reading by SPELLING each glyph aloud before sounding the
// whole word: a learner taps "نَ" and hears "Noon Zabar – Na", or "قَلْب" and
// hears "Qaaf Zabar Qa – Laam Jazm Ll – Bay Jazm Bb – Qalb". That callout is a
// pure function over (letter name × harakat × joining), so we generate it by
// rule rather than guessing with a model. The resulting `script` is what we feed
// to the TTS pipeline; the model only voices a string we fully control.
//
// Scope: the standard Noorani Qaida inventory — base letters, the three harakat
// (Zabar/Zer/Pesh), their tanween (Do-Zabar/Do-Zer/Do-Pesh), Madd (long vowels
// via a following Alif/Waw/Yaa), the standing harakat (Khari Zabar/Khari Zer/
// Ulti Pesh), Jazm (sukoon), and Tashdeed (shadda). Anything outside the table
// is skipped, never crashes.

// ─── Letter inventory ─────────────────────────────────────────────────────────
// name = how the Qaida calls the letter; c = its consonant transliteration.
export const LETTERS = {
  "ا": { name: "Alif", c: "" },
  "أ": { name: "Alif Hamza", c: "'" },
  "إ": { name: "Alif Hamza", c: "'" },
  "آ": { name: "Alif Madd", c: "", longA: true },
  "ب": { name: "Bay", c: "B" },
  "ت": { name: "Tay", c: "T" },
  "ث": { name: "Thay", c: "Th" },
  "ج": { name: "Jeem", c: "J" },
  "ح": { name: "Hhay", c: "H" },
  "خ": { name: "Khay", c: "Kh" },
  "د": { name: "Daal", c: "D" },
  "ذ": { name: "Zaal", c: "Dh" },
  "ر": { name: "Ray", c: "R" },
  "ز": { name: "Zay", c: "Z" },
  "س": { name: "Seen", c: "S" },
  "ش": { name: "Sheen", c: "Sh" },
  "ص": { name: "Saad", c: "S" },
  "ض": { name: "Daad", c: "D" },
  "ط": { name: "Toay", c: "T" },
  "ظ": { name: "Zoay", c: "Z" },
  "ع": { name: "Ain", c: "A" },
  "غ": { name: "Ghain", c: "Gh" },
  "ف": { name: "Fay", c: "F" },
  "ق": { name: "Qaaf", c: "Q" },
  "ك": { name: "Kaaf", c: "K" },
  "ل": { name: "Laam", c: "L" },
  "م": { name: "Meem", c: "M" },
  "ن": { name: "Noon", c: "N" },
  "و": { name: "Waw", c: "W" },
  "ه": { name: "Hay", c: "H" },
  "ة": { name: "Ta Marbuta", c: "T" },
  "ي": { name: "Yay", c: "Y" },
  "ى": { name: "Alif Maksura", c: "" },
  "ء": { name: "Hamza", c: "'" },
};

// ─── Harakat / marks (Unicode combining diacritics) ───────────────────────────
// name = Qaida term; v = vowel sound; kind groups behaviour; long = elongated.
export const MARKS = {
  "َ": { name: "Zabar", v: "a", kind: "vowel" },           // fatha
  "ِ": { name: "Zer", v: "i", kind: "vowel" },             // kasra
  "ُ": { name: "Pesh", v: "u", kind: "vowel" },            // damma
  "ْ": { name: "Jazm", v: "", kind: "sukoon" },            // sukoon
  "ً": { name: "Do Zabar", v: "an", kind: "tanween" },     // fathatan
  "ٍ": { name: "Do Zer", v: "in", kind: "tanween" },       // kasratan
  "ٌ": { name: "Do Pesh", v: "un", kind: "tanween" },      // dammatan
  "ّ": { name: "Tashdeed", v: "", kind: "shadda" },        // shadda
  "ٓ": { name: "Madd", v: "", kind: "madd" },              // maddah above
  "ٰ": { name: "Khari Zabar", v: "a", kind: "vowel", long: true }, // superscript alef
  "ٖ": { name: "Khari Zer", v: "i", kind: "vowel", long: true },   // subscript alef
  "ٗ": { name: "Ulti Pesh", v: "u", kind: "vowel", long: true },   // inverted damma
};

// Bare madd carriers: a vowel-less Alif/Waw/Yaa after a matching short vowel
// elongates it (Zabar+Alif → "aa", Pesh+Waw → "oo", Zer+Yaa → "ee").
const MADD_CARRIER = { "ا": "a", "ى": "a", "و": "u", "ي": "i" };

const isLetter = (ch) => Object.prototype.hasOwnProperty.call(LETTERS, ch);
const isMark = (ch) => Object.prototype.hasOwnProperty.call(MARKS, ch);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Split a word into ordered units: each a base letter plus the marks that follow
// it. Unknown codepoints (spaces, punctuation) are ignored. Exported for tests.
export function decompose(word) {
  const units = [];
  let cur = null;
  for (const ch of String(word || "")) {
    if (isLetter(ch)) {
      if (cur) units.push(cur);
      cur = { letter: ch, marks: [] };
    } else if (isMark(ch) && cur) {
      cur.marks.push(ch);
    }
    // else: ignore (whitespace, tatweel, punctuation, unsupported glyph)
  }
  if (cur) units.push(cur);
  return units;
}

// Resolve one unit into its parts: the vowel, whether it stops (sukoon), doubles
// (shadda), or elongates (long), plus the consonant + whether it's a bare madd
// carrier that may fuse into the previous unit.
function resolveUnit(unit) {
  const L = LETTERS[unit.letter] || { name: "?", c: "" };
  let vowel = "";
  let stop = false;
  let shadda = false;
  let long = Boolean(L.longA);
  const markNames = [];
  for (const m of unit.marks) {
    const M = MARKS[m];
    if (!M) continue;
    markNames.push(M.name);
    if (M.kind === "vowel" || M.kind === "tanween") { vowel = M.v; if (M.long) long = true; }
    else if (M.kind === "sukoon") stop = true;
    else if (M.kind === "shadda") shadda = true;
    else if (M.kind === "madd") long = true;
  }
  const isBareCarrier = unit.marks.length === 0 && Object.prototype.hasOwnProperty.call(MADD_CARRIER, unit.letter);
  // `glyph` is the raw Arabic for this unit (base letter + its marks). Kept so the
  // voice script can anchor each callout in real Arabic, not just transliteration.
  const glyph = unit.letter + unit.marks.join("");
  return { letter: unit.letter, glyph, name: L.name, c: L.c, vowel, stop, shadda, long, isBareCarrier, maddMerged: false, markNames };
}

// Fuse bare madd carriers into the preceding voweled unit, so "بَا" is one long
// "Baa" (Madd) rather than "Ba" + a stray "Alif".
function mergeMadd(units) {
  const out = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    if (prev && u.isBareCarrier && !u.vowel && !u.stop && !prev.stop && !prev.long) {
      if (MADD_CARRIER[u.letter] === prev.vowel) {
        prev.long = true;
        prev.maddMerged = true;
        prev.glyph += u.letter; // fuse the carrier into the elongated glyph (بَ + ا → بَا)
        continue;
      }
    }
    out.push(u);
  }
  return out;
}

// The emphatic callout sound for a single unit, e.g. "Na", "Qa", "Ll", "Baa".
function calloutSound(u) {
  const c = u.c;
  if (u.stop) return c ? cap(c) + c.toLowerCase() : "";   // clipped doubled stop
  const cc = u.shadda ? c + c.toLowerCase() : c;
  if (u.vowel) return cap(cc + (u.long ? u.vowel + u.vowel : u.vowel));
  if (u.long) return cap((c || "A") + "a");               // longA carrier (آ)
  return "";                                              // bare letter → name only
}

// The natural in-word sound used to assemble the whole-word readback ("Qalb").
function naturalSound(u) {
  if (u.stop) return u.c.toLowerCase();
  const c = u.shadda ? u.c + u.c : u.c;
  if (u.vowel) return (c + (u.long ? u.vowel + u.vowel : u.vowel)).toLowerCase();
  if (u.long) return ((u.c || "a") + "a").toLowerCase();
  return c.toLowerCase();
}

// Build the per-unit callout phrase: "<Letter> <Mark…> [Madd] <Sound>".
function unitPhrase(u) {
  const sound = calloutSound(u);
  const parts = [u.name, ...u.markNames];
  if (u.maddMerged) parts.push("Madd"); // elongation that came from a fused carrier
  if (sound && sound !== u.name) parts.push(sound);
  return parts.join(" ");
}

// ─── Public: spell a word out ─────────────────────────────────────────────────
// Returns { units, naturalWord, script } where `script` is the full spoken
// instruction fed to TTS, e.g. "Qaaf Zabar Qa – Laam Jazm Ll – Bay Jazm Bb –
// Qalb" (a single-glyph input omits the trailing whole-word readback).
export function spellOut(word) {
  const units = mergeMadd(decompose(word).map(resolveUnit));
  if (!units.length) return { units: [], naturalWord: "", script: "" };

  const phrases = units.map(unitPhrase).filter(Boolean);
  const naturalWord = cap(units.map(naturalSound).join(""));

  const script = units.length === 1
    ? phrases.join(" – ")
    : [...phrases, naturalWord].filter(Boolean).join(" – ");

  return { units, naturalWord, script };
}

// ─── Public: the TTS voice script ─────────────────────────────────────────────
// `spellOut().script` is a Latin transliteration ("Saad Zabar Sa – Daad Zabar Da
// – Sada"). It reads well for a parent, but fed to a TTS model it has NO Arabic
// in it, so the model misjudges the base language as English and voices the word
// in an English accent. `voiceScript` produces the string we actually feed to
// TTS: each callout is anchored in real Arabic glyphs — "<letter> <harakat>
// <voweled glyph>" — so the model recognizes Arabic and articulates it natively.
//
//   صَضَ  →  "ص zabar صَ ، ض zabar ضَ ، صَضَ"
//
// The harakat names (zabar/zer/…) stay as the Qaida's spoken terms; the voweled
// Arabic glyph right after each carries the true sound. A single glyph omits the
// trailing whole-word, mirroring spellOut.
const VOICE_SEP = " ، "; // Arabic comma → a natural pause that keeps the line in-script

// Harakat terms written in (Urdu) Arabic script. The default voice script keeps
// the Latin terms (zabar/zer/…), which Gemini's strongly-multilingual TTS voices
// correctly. OpenAI's TTS, however, detects those Latin tokens and flips the whole
// line to ENGLISH phonetics — voicing the Arabic in an English accent. Rendering
// the harakat in Arabic script keeps the entire string non-Latin, so OpenAI stays
// in Arabic and articulates each callout natively. Same Qaida terms, Arabic glyphs.
const HARAKAT_AR = {
  "Zabar": "زبر", "Zer": "زیر", "Pesh": "پیش", "Jazm": "جزم",
  "Do Zabar": "دو زبر", "Do Zer": "دو زیر", "Do Pesh": "دو پیش",
  "Tashdeed": "تشدید", "Madd": "مد",
  "Khari Zabar": "کھڑی زبر", "Khari Zer": "کھڑی زیر", "Ulti Pesh": "الٹی پیش",
};

function unitVoice(u, arabic = false) {
  const words = u.markNames.map((n) => (arabic ? HARAKAT_AR[n] || n : n.toLowerCase()));
  if (u.maddMerged) words.push(arabic ? "مد" : "madd"); // elongation fused from a trailing carrier
  // A bare letter (no marks) is just named once; a voweled unit names the letter,
  // its harakat, then the actual voweled glyph.
  if (!words.length && u.glyph === u.letter) return u.letter;
  return [u.letter, ...words, u.glyph].join(" ");
}

// `arabic: true` renders the harakat terms in Arabic script (for the OpenAI lane);
// the default (Latin terms) is unchanged so Gemini behaves exactly as before.
// `wordLabel: true` prefixes the whole-word readback with "الكلمة الكاملة:" — the
// explicit cue that tells the TTS model "speak this as one connected word, not
// another spell element". Meaningful for multi-letter words only.
// `wordRepeat: true` appends a second repetition of the complete word so the child
// hears: jor-tor → word → word again (slowly). The directive instructs the model
// to say the second repetition more slowly. All three flags compose freely.
export function voiceScript(word, { arabic = false, wordLabel = false, wordRepeat = false } = {}) {
  const units = mergeMadd(decompose(word).map(resolveUnit));
  if (!units.length) return "";
  const phrases = units.map((u) => unitVoice(u, arabic));
  const arabicWord = units.map((u) => u.glyph).join("");

  if (units.length === 1) {
    // Single glyph: the jor-tor phrase already captures the sound; repeat the bare
    // glyph twice after it so the format is consistent with multi-letter words.
    const base = phrases.join(VOICE_SEP);
    return wordRepeat ? [base, arabicWord, arabicWord].join(VOICE_SEP) : base;
  }

  const wordPart = wordLabel ? `الكلمة الكاملة: ${arabicWord}` : arabicWord;
  const parts = [...phrases, wordPart];
  if (wordRepeat) parts.push(arabicWord); // second repetition — model told to say it more slowly
  return parts.join(VOICE_SEP);
}
