import { describe, it, expect } from "vitest";
import { splitBismillahWords, splitBismillahText } from "./bismillah";

// Al-Ikhlas ayah 1 as returned by the verified source: Bismillah fused onto the
// real ayah, per Uthmani mushaf convention.
const IKHLAS_AYAH1 = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ قُلْ هُوَ اللَّهُ أَحَدٌ";
const IKHLAS_REST = "قُلْ هُوَ اللَّهُ أَحَدٌ";
const AL_FATIHA_AYAH1 = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"; // the Bismillah itself

describe("splitBismillahText", () => {
  it("splits a fused Bismillah + ayah into its two parts", () => {
    const { bismillah, verse } = splitBismillahText(IKHLAS_AYAH1);
    expect(bismillah).toBe("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
    expect(verse).toBe(IKHLAS_REST);
  });

  it("leaves Al-Fatihah's real ayah 1 (which IS just the Bismillah) untouched", () => {
    const { bismillah, verse } = splitBismillahText(AL_FATIHA_AYAH1);
    expect(bismillah).toBe("");
    expect(verse).toBe(AL_FATIHA_AYAH1);
  });

  it("leaves an ayah with no Bismillah prefix untouched (e.g. At-Tawbah's opening)", () => {
    const text = "بَرَاءَةٌ مِنَ اللَّهِ وَرَسُولِهِ";
    const { bismillah, verse } = splitBismillahText(text);
    expect(bismillah).toBe("");
    expect(verse).toBe(text);
  });

  it("handles empty input", () => {
    expect(splitBismillahText("")).toEqual({ bismillah: "", verse: "" });
    expect(splitBismillahText(undefined)).toEqual({ bismillah: "", verse: "" });
  });
});

describe("splitBismillahWords", () => {
  const words = (arabics) => arabics.map((arabic) => ({ arabic, transliteration: "" }));

  it("splits the first four words off when they match the Bismillah", () => {
    const list = words(["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ", "قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]);
    const { bismillahWords, verseWords } = splitBismillahWords(list);
    expect(bismillahWords).toHaveLength(4);
    expect(bismillahWords.map((w) => w.arabic)).toEqual(["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ"]);
    expect(verseWords).toHaveLength(4);
    expect(verseWords.map((w) => w.arabic)).toEqual(["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]);
  });

  it("leaves a 4-word ayah (Al-Fatihah's real ayah 1) untouched", () => {
    const list = words(["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ"]);
    const { bismillahWords, verseWords } = splitBismillahWords(list);
    expect(bismillahWords).toEqual([]);
    expect(verseWords).toEqual(list);
  });

  it("leaves words with no Bismillah prefix untouched", () => {
    const list = words(["الْحَمْدُ", "لِلَّهِ", "رَبِّ", "الْعَالَمِينَ"]);
    const { bismillahWords, verseWords } = splitBismillahWords(list);
    expect(bismillahWords).toEqual([]);
    expect(verseWords).toEqual(list);
  });

  it("tolerates a non-array or empty input", () => {
    expect(splitBismillahWords(undefined)).toEqual({ bismillahWords: [], verseWords: [] });
    expect(splitBismillahWords([])).toEqual({ bismillahWords: [], verseWords: [] });
  });
});
