// The standard Noorani Qaida lesson progression, as editable data.
//
// This is the canonical, platform-level corpus — generated once and shared by
// every family (like the shared `quran/*` collection), then audited by the
// superadmin. It follows the classic Qaida: individual letters → joined forms →
// harakat (Zabar/Zer/Pesh) → tanween → madd (long vowels) → standing harakat →
// leen → jazm → tashdeed (+ combinations). Coverage is SYSTEMATIC: each harakat
// lesson applies to every voiced letter, not a sample.
//
// Glyphs are built from base letters + combining diacritics so the set stays
// consistent with qaidaSpell.js's tables. Each lesson carries meta the syllabus
// builder reads later (repeatable + frequency + complexity); memorisation drills
// are inherently repeatable. The superadmin can extend/reorder after import.

// Combining harakat (Unicode).
const FATHA = "َ";   // Zabar
const KASRA = "ِ";   // Zer
const DAMMA = "ُ";   // Pesh
const SUKOON = "ْ";  // Jazm
const FATHATAN = "ً"; // Do Zabar
const KASRATAN = "ٍ"; // Do Zer
const DAMMATAN = "ٌ"; // Do Pesh
const SHADDA = "ّ";   // Tashdeed
const SUP_ALIF = "ٰ"; // Khari Zabar (standing fatha)
const SUB_ALIF = "ٖ"; // Khari Zer (standing kasra)
const INV_DAMMA = "ٗ"; // Ulti Pesh (inverted damma)
const ALIF = "ا", WAW = "و", YAA = "ي";

// The 28 base letters in standard Qaida order.
const BASE_LETTERS = [
  "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر",
  "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف",
  "ق", "ك", "ل", "م", "ن", "و", "ه", "ي",
];

// Letters that take an articulable harakat (Alif is a carrier, taught under Madd).
const VOICED = BASE_LETTERS.filter((l) => l !== "ا");
const N = VOICED.length;

const each = (mark) => VOICED.map((l) => l + mark);

// ─── The lessons ──────────────────────────────────────────────────────────────
export const STANDARD_QAIDA_LESSONS = [
  {
    id: "01-huroof-mufradat",
    order: 1,
    title: "Huroof Mufradat — Individual Letters",
    kind: "letters",
    meta: { complexity: 1, repeatable: true, repeatFrequency: "daily" },
    glyphs: BASE_LETTERS,
  },
  {
    id: "02-huroof-murakkabat",
    order: 2,
    title: "Huroof Murakkabat — Joined Letters",
    kind: "murakkabat",
    meta: { complexity: 2, repeatable: true, repeatFrequency: "daily" },
    // Two-letter joins (adjacent pairs) + a band of three-letter joins, all
    // voweled so the joining shapes are practised aloud.
    glyphs: [
      ...VOICED.map((l, i) => l + FATHA + VOICED[(i + 1) % N] + FATHA),
      ...VOICED.slice(0, 12).map((l, i) => l + FATHA + VOICED[i + 1] + FATHA + VOICED[i + 2] + SUKOON),
    ],
  },
  {
    id: "03-zabar",
    order: 3,
    title: "Zabar — Fatha on Every Letter",
    kind: "harakat",
    meta: { complexity: 2, repeatable: true, repeatFrequency: "daily" },
    glyphs: each(FATHA),
  },
  {
    id: "04-zer",
    order: 4,
    title: "Zer — Kasra on Every Letter",
    kind: "harakat",
    meta: { complexity: 2, repeatable: true, repeatFrequency: "daily" },
    glyphs: each(KASRA),
  },
  {
    id: "05-pesh",
    order: 5,
    title: "Pesh — Damma on Every Letter",
    kind: "harakat",
    meta: { complexity: 2, repeatable: true, repeatFrequency: "daily" },
    glyphs: each(DAMMA),
  },
  {
    id: "06-tanween",
    order: 6,
    title: "Tanween — Do Zabar, Do Zer, Do Pesh on Every Letter",
    kind: "tanween",
    meta: { complexity: 3, repeatable: true, repeatFrequency: "daily" },
    glyphs: [...each(FATHATAN), ...each(KASRATAN), ...each(DAMMATAN)],
  },
  {
    id: "07-madd",
    order: 7,
    title: "Huroof Maddah — Long Vowels (Alif, Waw, Yay)",
    kind: "madd",
    meta: { complexity: 3, repeatable: true, repeatFrequency: "daily" },
    // baa / boo / bee across every letter.
    glyphs: VOICED.flatMap((l) => [l + FATHA + ALIF, l + DAMMA + WAW, l + KASRA + YAA]),
  },
  {
    id: "08-khari-harakat",
    order: 8,
    title: "Khari Zabar, Khari Zer, Ulti Pesh — Standing Harakat",
    kind: "standing",
    meta: { complexity: 4, repeatable: true, repeatFrequency: "weekly" },
    glyphs: [
      ...each(SUP_ALIF),
      ...VOICED.slice(0, 8).map((l) => l + SUB_ALIF),
      ...VOICED.slice(0, 8).map((l) => l + INV_DAMMA),
    ],
  },
  {
    id: "09-leen",
    order: 9,
    title: "Huroof Leen — Soft Waw & Yay",
    kind: "leen",
    meta: { complexity: 4, repeatable: true, repeatFrequency: "weekly" },
    // fatha then a sukoon'd Waw / Yay (aw / ay).
    glyphs: [
      ...VOICED.slice(0, 7).map((l) => l + FATHA + WAW + SUKOON),
      ...VOICED.slice(0, 7).map((l) => l + FATHA + YAA + SUKOON),
    ],
  },
  {
    id: "10-jazm",
    order: 10,
    title: "Jazm — Sukoon (Joining Letters)",
    kind: "jazm",
    meta: { complexity: 4, repeatable: true, repeatFrequency: "daily" },
    glyphs: [
      // systematic: fatha + a sukoon'd later letter, across every letter
      ...VOICED.map((l, i) => l + FATHA + VOICED[(i + 3) % N] + SUKOON),
      // plus familiar Qaida/Qur'anic short words
      "أَبْ", "اِبْ", "اُمْ", "قُلْ", "مِنْ", "لَمْ", "كَمْ", "هَلْ", "قَلْبْ", "صَبْرْ", "فَجْرْ", "عَبْدْ",
    ],
  },
  {
    id: "11-tashdeed",
    order: 11,
    title: "Tashdeed — Shadda (Doubled Letters)",
    kind: "tashdeed",
    meta: { complexity: 5, repeatable: true, repeatFrequency: "daily" },
    // shadda + fatha on every letter.
    glyphs: VOICED.map((l) => l + SHADDA + FATHA),
  },
  {
    id: "12-tashdeed-combos",
    order: 12,
    title: "Tashdeed with Madd & Jazm — Combinations",
    kind: "tashdeed",
    meta: { complexity: 5, repeatable: true, repeatFrequency: "weekly" },
    glyphs: [
      // tashdeed + madd
      ...VOICED.slice(0, 8).map((l) => l + SHADDA + FATHA + ALIF),
      // common doubled words
      "رَبَّ", "حَجَّ", "مَدَّ", "شَدَّ", "حَقَّ", "اَنَّ", "اِنَّ", "ثُمَّ",
    ],
  },
];

export const TOTAL_QAIDA_LESSONS = STANDARD_QAIDA_LESSONS.length;

// Total drill items across the corpus (for status/tests).
export const TOTAL_QAIDA_ITEMS = STANDARD_QAIDA_LESSONS.reduce((n, l) => n + l.glyphs.length, 0);
