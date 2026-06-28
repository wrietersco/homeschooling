import { test } from "node:test";
import assert from "node:assert/strict";
import { spellOut, voiceScript, decompose, LETTERS, MARKS } from "../agents/qaidaSpell.js";

test("single voweled glyph spells letter + harakat + sound, no readback", () => {
  // نَ  → "Noon Zabar Na"
  const { script, naturalWord } = spellOut("نَ");
  assert.equal(script, "Noon Zabar Na");
  assert.equal(naturalWord, "Na");
});

test("the canonical Qalb example matches the spec exactly", () => {
  // قَلْبْ → Qaaf Zabar Qa – Laam Jazm Ll – Bay Jazm Bb – Qalb
  const { script, naturalWord } = spellOut("قَلْبْ");
  assert.equal(script, "Qaaf Zabar Qa – Laam Jazm Ll – Bay Jazm Bb – Qalb");
  assert.equal(naturalWord, "Qalb");
});

test("the three harakat map to Zabar / Zer / Pesh with a/i/u", () => {
  assert.equal(spellOut("بَ").script, "Bay Zabar Ba");
  assert.equal(spellOut("بِ").script, "Bay Zer Bi");
  assert.equal(spellOut("بُ").script, "Bay Pesh Bu");
});

test("tanween are spelled Do-Zabar / Do-Zer / Do-Pesh with -an/-in/-un", () => {
  assert.equal(spellOut("بً").script, "Bay Do Zabar Ban");
  assert.equal(spellOut("بٍ").script, "Bay Do Zer Bin");
  assert.equal(spellOut("بٌ").script, "Bay Do Pesh Bun");
});

test("a bare letter with no harakat is read as its name only", () => {
  assert.equal(spellOut("ج").script, "Jeem");
  assert.equal(spellOut("ق").script, "Qaaf");
});

test("jazm (sukoon) yields a clipped doubled-consonant callout", () => {
  // a two-letter word ending in sukoon: لَبْ → Laam Zabar La – Bay Jazm Bb – Lab
  const { script, naturalWord } = spellOut("لَبْ");
  assert.equal(script, "Laam Zabar La – Bay Jazm Bb – Lab");
  assert.equal(naturalWord, "Lab");
});

test("tashdeed (shadda) doubles the consonant in the readback", () => {
  // رَبّ → Ray Zabar Ra – Bay Tashdeed Bba – Rabba
  const { script, naturalWord } = spellOut("رَبَّ");
  assert.equal(naturalWord, "Rabba");
  assert.match(script, /Tashdeed/);
});

test("madd: a trailing Alif/Waw/Yaa elongates the vowel, not a stray letter", () => {
  // بَا → Bay Zabar Madd Baa (one fused unit, no readback, no lone "Alif")
  const baa = spellOut("بَا");
  assert.equal(baa.script, "Bay Zabar Madd Baa");
  assert.equal(baa.naturalWord, "Baa");
  assert.equal(spellOut("بُو").naturalWord, "Buu"); // Pesh + Waw (long u)
  assert.equal(spellOut("بِي").naturalWord, "Bii"); // Zer + Yaa (long i)
  // a non-matching pairing does NOT fuse (Zabar + Waw stays two units).
  assert.match(spellOut("بَو").script, /Waw/);
});

test("standing harakat: Khari Zabar / Khari Zer / Ulti Pesh read as long vowels", () => {
  assert.equal(spellOut("بٰ").script, "Bay Khari Zabar Baa");
  assert.equal(spellOut("بٖ").script, "Bay Khari Zer Bii");
  assert.equal(spellOut("بٗ").script, "Bay Ulti Pesh Buu");
});

test("decompose groups marks under their preceding letter and ignores spaces", () => {
  const units = decompose("قَلْب");
  assert.equal(units.length, 3);
  assert.equal(units[0].letter, "ق");
  assert.deepEqual(units[0].marks, ["َ"]);
  assert.equal(units[1].letter, "ل");
  assert.deepEqual(units[1].marks, ["ْ"]);
  assert.equal(units[2].letter, "ب");
  assert.deepEqual(units[2].marks, []);
});

test("unknown / empty input never throws and yields an empty script", () => {
  assert.deepEqual(spellOut(""), { units: [], naturalWord: "", script: "" });
  assert.deepEqual(spellOut("   ").script, "");
  assert.deepEqual(spellOut(null).script, "");
  assert.deepEqual(spellOut("123 abc").script, ""); // no Arabic letters
});

test("voiceScript anchors each callout in Arabic glyphs (not Latin transliteration)", () => {
  // صَضَ → "ص zabar صَ ، ض zabar ضَ ، صَضَ" — the user's canonical fix. The
  // Arabic dominates so a TTS model voices it natively, not in an English accent.
  const v = voiceScript("صَضَ");
  assert.equal(v, "ص zabar صَ ، ض zabar ضَ ، صَضَ");
  // Contains real Arabic and ends with the whole Arabic word.
  assert.match(v, /[؀-ۿ]/);
  assert.ok(v.endsWith("صَضَ"));
});

test("voiceScript: a single voweled glyph names letter + harakat + glyph, no readback", () => {
  assert.equal(voiceScript("بَ"), "ب zabar بَ");
  assert.equal(voiceScript("بِ"), "ب zer بِ");
  assert.equal(voiceScript("بُ"), "ب pesh بُ");
});

test("voiceScript: a bare letter is just named once (no duplicate glyph)", () => {
  assert.equal(voiceScript("ج"), "ج");
  assert.equal(voiceScript("ق"), "ق");
});

test("voiceScript: a fused madd carrier stays in the elongated glyph, not a stray letter", () => {
  // بَا is one elongated unit — the trailing Alif fuses, it is NOT voiced alone.
  assert.equal(voiceScript("بَا"), "ب zabar madd بَا");
});

test("voiceScript: empty / non-Arabic input yields an empty string, never throws", () => {
  assert.equal(voiceScript(""), "");
  assert.equal(voiceScript("   "), "");
  assert.equal(voiceScript(null), "");
  assert.equal(voiceScript("123 abc"), "");
});

test("voiceScript arabic mode renders harakat in Arabic script (no Latin tokens for OpenAI)", () => {
  // Default (Gemini) keeps the Latin term; arabic mode swaps it for Arabic script.
  assert.equal(voiceScript("بَ"), "ب zabar بَ");
  assert.equal(voiceScript("بَ", { arabic: true }), "ب زبر بَ");
  assert.equal(voiceScript("بِ", { arabic: true }), "ب زیر بِ");
  assert.equal(voiceScript("بُ", { arabic: true }), "ب پیش بُ");
  // The whole arabic-mode string contains NO Latin letters (the cause of the bug).
  const v = voiceScript("صَضَ", { arabic: true });
  assert.ok(!/[A-Za-z]/.test(v), `arabic voice script should have no Latin letters: ${v}`);
  assert.match(v, /صَضَ$/); // still ends with the whole-word readback
  // Fused madd carrier uses the Arabic term too.
  assert.equal(voiceScript("بَا", { arabic: true }), "ب زبر مد بَا");
});

test("voiceScript wordLabel: prefixes whole-word readback for multi-letter words only", () => {
  // Multi-letter: label added before the whole-word readback so the TTS model
  // treats it as "now speak this as one connected word".
  assert.equal(
    voiceScript("قَلْبْ", { arabic: true, wordLabel: true }),
    "ق زبر قَ ، ل جزم لْ ، ب جزم بْ ، الكلمة الكاملة: قَلْبْ"
  );
  // Single glyph: no readback, wordLabel has no effect.
  assert.equal(voiceScript("بَ", { arabic: true, wordLabel: true }), "ب زبر بَ");
  // Latin mode + wordLabel also works (Gemini path).
  assert.match(voiceScript("قَلْبْ", { wordLabel: true }), /الكلمة الكاملة:/);
});

test("every standard letter and mark has a name (table integrity)", () => {
  assert.equal(LETTERS["ن"].name, "Noon");
  assert.equal(LETTERS["ق"].name, "Qaaf");
  assert.equal(MARKS["َ"].name, "Zabar");
  assert.equal(MARKS["ْ"].name, "Jazm");
  for (const [, v] of Object.entries(LETTERS)) assert.ok(v.name, "letter missing name");
  for (const [, v] of Object.entries(MARKS)) assert.ok(v.name, "mark missing name");
});
