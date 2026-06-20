import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enrichQuranContent,
  fetchChapterVerses,
  fetchPublicQuranBundle,
  isConfigured,
  publicQuranSourceMeta,
} from "../agents/quranSource.js";

const editions = {
  "quran-uthmani": {
    code: 200,
    data: {
      surahs: [{
        number: 1,
        name: "سُورَةُ ٱلْفَاتِحَةِ",
        englishName: "Al-Faatiha",
        englishNameTranslation: "The Opening",
        revelationType: "Meccan",
        ayahs: [
          { number: 1, numberInSurah: 1, text: "بِسْمِ ٱللَّهِ", page: 1, juz: 1, ruku: 1 },
          { number: 2, numberInSurah: 2, text: "ٱلْحَمْدُ لِلَّهِ", page: 1, juz: 1, ruku: 1 },
        ],
      }],
    },
  },
  "en.sahih": {
    code: 200,
    data: {
      surahs: [{
        number: 1,
        ayahs: [
          { number: 1, numberInSurah: 1, text: "In the name of Allah" },
          { number: 2, numberInSurah: 2, text: "All praise is due to Allah" },
        ],
      }],
    },
  },
  "en.transliteration": {
    code: 200,
    data: {
      surahs: [{
        number: 1,
        ayahs: [
          { number: 1, numberInSurah: 1, text: "Bismi Allahi" },
          { number: 2, numberInSurah: 2, text: "Alhamdu lillahi" },
        ],
      }],
    },
  },
};

function fakeFetch(url) {
  const u = String(url);
  // Full-bundle endpoint: /quran/{edition}
  const fullEdition = Object.keys(editions).find((key) => u.endsWith(`/quran/${key}`));
  if (fullEdition) {
    return Promise.resolve({ ok: true, status: 200, json: async () => editions[fullEdition] });
  }
  // Per-surah endpoint: /surah/{n}/{edition} → data is the single surah object.
  const m = /\/surah\/(\d+)\/([\w.-]+)$/.exec(u);
  if (m) {
    const surahNum = Number(m[1]);
    const edition = m[2];
    const surahObj = editions[edition]?.data?.surahs?.find((s) => Number(s.number) === surahNum);
    if (!surahObj) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ code: 200, data: surahObj }) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

test("Quran public source is always configured and documents provider metadata", () => {
  assert.equal(isConfigured(), true);
  assert.equal(publicQuranSourceMeta().provider, "public-no-key");
  assert.equal(publicQuranSourceMeta().source, "alquran.cloud");
});

test("fetchPublicQuranBundle merges Arabic, translation, transliteration, and audio", async () => {
  const chapters = await fetchPublicQuranBundle({ fetchImpl: fakeFetch });
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].nameSimple, "Al-Faatiha");
  assert.equal(chapters[0].versesCount, 2);
  assert.equal(chapters[0].verses[0].arabic, "بِسْمِ ٱللَّهِ");
  assert.equal(chapters[0].verses[0].translation, "In the name of Allah");
  assert.equal(chapters[0].verses[0].transliteration, "Bismi Allahi");
  assert.equal(chapters[0].verses[0].words.length, 2);
  assert.match(chapters[0].verses[0].audioUrl, /001001\.mp3$/);
  assert.match(chapters[0].chapterAudioUrl, /001\.mp3$/);
});

test("fetchChapterVerses returns a single surah's verses", async () => {
  const verses = await fetchChapterVerses({ surah: 1, fetchImpl: fakeFetch });
  assert.equal(verses.length, 2);
  assert.equal(verses[1].ayah, 2);
  assert.equal(verses[1].translation, "All praise is due to Allah");
});

test("enrichQuranContent falls back to the no-key source when local docs are absent", async () => {
  const content = {
    kind: "quran_reading",
    quran: {
      verses: [{ surah: 1, ayah: 1, arabic: "draft", translation: "" }],
    },
  };

  await enrichQuranContent(content, { fetchImpl: fakeFetch });

  assert.equal(content.quran.textSource, "alquran.cloud");
  assert.equal(content.quran.verses[0].arabic, "بِسْمِ ٱللَّهِ");
  assert.equal(content.quran.verses[0].translation, "In the name of Allah");
  assert.equal(content.quran.verses[0].words.length, 2);
});

test("verified words carry canonical 1-based per-word audio URLs (audit #10)", async () => {
  const verses = await fetchChapterVerses({ surah: 1, fetchImpl: fakeFetch });
  // Word audio is keyed to the canonical tokenisation, not the LLM draft split.
  assert.match(verses[0].words[0].audioUrl, /wbw\/001_001_001\.mp3$/);
  assert.match(verses[0].words[1].audioUrl, /wbw\/001_001_002\.mp3$/);
});
