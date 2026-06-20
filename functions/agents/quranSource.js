// Verified Quran text source using public no-key providers.
//
// The activity agent decides WHICH verses an activity covers (surah:ayah), but
// canonical Arabic text, transliteration, translation, and recitation links must
// come from a verified source, never an LLM. This module uses AlQuran.Cloud for
// text/translation/transliteration and stable public audio URL patterns for
// recitation. Imported Firestore docs remain the preferred local source.

const ALQURAN_BASE = "https://api.alquran.cloud/v1";
const ARABIC_EDITION = "quran-uthmani";
const TRANSLATION_EDITION = "en.sahih";
const TRANSLITERATION_EDITION = "en.transliteration";

const EVERYAYAH_BASE = "https://everyayah.com/data/Alafasy_128kbps";
const MP3QURAN_ALAFASY_SERVER = "https://server8.mp3quran.net/afs/";
const MP3QURAN_ALAFASY_ID = 123;

const pad3 = (n) => String(n).padStart(3, "0");
const ayahRecitationUrl = (surah, ayah) => `${EVERYAYAH_BASE}/${pad3(surah)}${pad3(ayah)}.mp3`;
const chapterRecitationUrl = (surah) => `${MP3QURAN_ALAFASY_SERVER}${pad3(surah)}.mp3`;
// Per-word recitation (quran.com word-by-word CDN). wordIndex is 1-based within
// the ayah's canonical tokenisation.
const wordRecitationUrl = (surah, ayah, wordIndex) =>
  `https://audio.qurancdn.com/wbw/${pad3(surah)}_${pad3(ayah)}_${pad3(wordIndex)}.mp3`;

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "").trim();
}

function splitTokens(text) {
  return stripBom(text).split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

function buildWords(arabic, transliteration, surah, ayah) {
  const ar = splitTokens(arabic);
  const tr = splitTokens(transliteration);
  return ar.map((word, i) => ({
    arabic: word,
    transliteration: tr.length === ar.length ? tr[i] || "" : "",
    // Per-word audio is computed off the CANONICAL tokenisation (1-based), so it
    // stays in sync with the WBW CDN — unlike the LLM draft's word split (audit #10).
    ...(surah && ayah ? { audioUrl: wordRecitationUrl(surah, ayah, i + 1) } : {}),
  }));
}

// The verified Quran source carries arabic + transliteration only. Word-by-word
// English/Urdu meanings are interpretive glosses the LLM drafted, so re-attach
// them by position when the verified split has the same word count (the draft is
// instructed to split exactly as the mushaf does). Mismatched counts drop the
// per-word gloss for that ayah and fall back to the verified ayah translation.
function mergeWordGlosses(verifiedWords, draftWords) {
  if (!Array.isArray(verifiedWords) || !Array.isArray(draftWords)) return verifiedWords;
  if (verifiedWords.length !== draftWords.length) return verifiedWords;
  return verifiedWords.map((w, i) => {
    const d = draftWords[i] || {};
    const en = typeof d.en === "string" ? d.en.trim() : "";
    const ur = typeof d.ur === "string" ? d.ur.trim() : "";
    return { ...w, ...(en ? { en } : {}), ...(ur ? { ur } : {}) };
  });
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Quran source ${res.status}: ${url}`);
  const json = await res.json();
  if (json.code && json.code !== 200) throw new Error(`Quran source code ${json.code}: ${url}`);
  return json.data;
}

async function fetchEdition(edition, fetchImpl) {
  const data = await fetchJson(`${ALQURAN_BASE}/quran/${edition}`, fetchImpl);
  return data?.surahs || [];
}

function findAyah(surah, ayah) {
  return (surah?.ayahs || []).find((a) => Number(a.numberInSurah) === Number(ayah)) || null;
}

function buildVerse({ surahNumber, arabicAyah, translationAyah, transliterationAyah }) {
  const ayah = Number(arabicAyah.numberInSurah);
  const arabic = stripBom(arabicAyah.text);
  const transliteration = stripBom(transliterationAyah?.text || "");
  return {
    ayah,
    globalAyah: Number(arabicAyah.number) || null,
    arabic,
    transliteration,
    translation: stripBom(translationAyah?.text || ""),
    words: buildWords(arabic, transliteration, surahNumber, ayah),
    audioUrl: ayahRecitationUrl(surahNumber, ayah),
    page: arabicAyah.page || null,
    juz: arabicAyah.juz || null,
    ruku: arabicAyah.ruku || null,
    hizbQuarter: arabicAyah.hizbQuarter || null,
    sajda: arabicAyah.sajda || false,
  };
}

// Build a full chapter object from the three per-edition surah payloads. Shared
// by the full-bundle import and the per-surah on-demand fetch.
function buildChapter(arabicSurah, translationSurah, transliterationSurah) {
  const surahNumber = Number(arabicSurah.number);
  const verses = (arabicSurah.ayahs || []).map((arabicAyah) => buildVerse({
    surahNumber,
    arabicAyah,
    translationAyah: findAyah(translationSurah, arabicAyah.numberInSurah),
    transliterationAyah: findAyah(transliterationSurah, arabicAyah.numberInSurah),
  }));
  return {
    id: surahNumber,
    surah: surahNumber,
    nameSimple: arabicSurah.englishName || "",
    nameArabic: stripBom(arabicSurah.name),
    englishName: arabicSurah.englishName || "",
    englishNameTranslation: arabicSurah.englishNameTranslation || "",
    revelationType: arabicSurah.revelationType || "",
    versesCount: verses.length,
    ayahCount: verses.length,
    chapterAudioUrl: chapterRecitationUrl(surahNumber),
    verses,
    ...publicQuranSourceMeta(),
  };
}

// ── Per-surah on-demand fetch (audit #2) ──────────────────────────────────────
// The previous fetchVerse → fetchChapterVerses → fetchPublicQuranBundle chain
// downloaded ALL 114 surahs × 3 editions for EACH missing verse. We now fetch a
// single surah's three editions and cache it, so enriching a typical one-surah
// activity costs one small fetch instead of a whole-Qur'an download per verse.
const _surahCache = new Map();

async function fetchSurahEdition(surah, edition, fetchImpl) {
  // data is the surah object itself (with .ayahs) for the per-surah endpoint.
  return fetchJson(`${ALQURAN_BASE}/surah/${Number(surah)}/${edition}`, fetchImpl);
}

export async function fetchSurahBundle({ surah, fetchImpl = globalThis.fetch } = {}) {
  const key = Number(surah);
  // Only cache the real network client; injected fakes (tests) bypass the cache
  // so each test is deterministic and isolated.
  const useCache = fetchImpl === globalThis.fetch;
  if (useCache && _surahCache.has(key)) return _surahCache.get(key);
  const [arabicSurah, translationSurah, transliterationSurah] = await Promise.all([
    fetchSurahEdition(surah, ARABIC_EDITION, fetchImpl),
    fetchSurahEdition(surah, TRANSLATION_EDITION, fetchImpl),
    fetchSurahEdition(surah, TRANSLITERATION_EDITION, fetchImpl),
  ]);
  const chapter = buildChapter(arabicSurah, translationSurah, transliterationSurah);
  if (useCache) _surahCache.set(key, chapter);
  return chapter;
}

export function isConfigured() {
  return true;
}

export function publicQuranSourceMeta() {
  return {
    provider: "public-no-key",
    source: "alquran.cloud",
    arabicEdition: ARABIC_EDITION,
    translationEdition: TRANSLATION_EDITION,
    transliterationEdition: TRANSLITERATION_EDITION,
    ayahAudioSource: "everyayah.com/alafasy",
    chapterAudioSource: "mp3quran.net/alafasy",
    reciter: {
      id: MP3QURAN_ALAFASY_ID,
      name: "Mishary Alafasy",
      server: MP3QURAN_ALAFASY_SERVER,
    },
  };
}

// Module-level cache of the full bundle so a batched import (audit #4) doesn't
// re-download all 114 surahs × 3 editions on every batch invocation that lands on
// a warm instance. Bypassed for injected fakes so tests stay isolated.
let _fullBundleCache = null;

export async function fetchPublicQuranBundle({ fetchImpl = globalThis.fetch } = {}) {
  const useCache = fetchImpl === globalThis.fetch;
  if (useCache && _fullBundleCache) return _fullBundleCache;

  const [arabicSurahs, translationSurahs, transliterationSurahs] = await Promise.all([
    fetchEdition(ARABIC_EDITION, fetchImpl),
    fetchEdition(TRANSLATION_EDITION, fetchImpl),
    fetchEdition(TRANSLITERATION_EDITION, fetchImpl),
  ]);

  const byNumber = (surahs) => new Map(surahs.map((s) => [Number(s.number), s]));
  const translationByNumber = byNumber(translationSurahs);
  const transliterationByNumber = byNumber(transliterationSurahs);

  const bundle = arabicSurahs.map((arabicSurah) =>
    buildChapter(
      arabicSurah,
      translationByNumber.get(Number(arabicSurah.number)),
      transliterationByNumber.get(Number(arabicSurah.number))
    )
  );
  if (useCache) _fullBundleCache = bundle;
  return bundle;
}

export async function fetchChapters({ fetchImpl = globalThis.fetch } = {}) {
  const chapters = await fetchPublicQuranBundle({ fetchImpl });
  return chapters.map((c) => ({
    id: c.id,
    nameSimple: c.nameSimple,
    nameArabic: c.nameArabic,
    englishName: c.englishName,
    englishNameTranslation: c.englishNameTranslation,
    revelationType: c.revelationType,
    versesCount: c.versesCount,
    chapterAudioUrl: c.chapterAudioUrl,
  }));
}

export async function fetchChapterVerses({ surah, fetchImpl = globalThis.fetch }) {
  // Per-surah fetch (audit #2) — no longer downloads the whole Qur'an per call.
  const ch = await fetchSurahBundle({ surah, fetchImpl });
  if (!ch) throw new Error(`Quran source: missing surah ${surah}`);
  return ch.verses;
}

export async function fetchVerse({ surah, ayah, fetchImpl = globalThis.fetch }) {
  const verses = await fetchChapterVerses({ surah, fetchImpl });
  const verse = verses.find((v) => Number(v.ayah) === Number(ayah));
  if (!verse) throw new Error(`Quran source: missing verse ${surah}:${ayah}`);
  return verse;
}

function sourceLabelForDocs(docs, surahNums) {
  const labels = surahNums
    .map((s) => docs[s]?.source || docs[s]?.provider || "")
    .filter(Boolean);
  const unique = [...new Set(labels)];
  if (!unique.length) return "local";
  return unique.length === 1 ? unique[0] : "local";
}

// Enrich a quran_reading content object in place with verified Arabic, words,
// translation, transliteration, and audio. LOCAL-FIRST: when `db` is given, read
// imported `quran/*` docs; missing verses fall back to the no-key public source.
export async function enrichQuranContent(content, { db = null, fetchImpl = globalThis.fetch } = {}) {
  if (!content?.quran?.verses?.length) return content;
  const verses = content.quran.verses;

  let localCovered = 0;
  let localSource = "local";
  if (db) {
    const surahNums = [...new Set(verses.map((v) => Number(v.surah)).filter(Boolean))];
    const docs = {};
    await Promise.all(surahNums.map(async (s) => {
      try {
        const d = await db.collection("quran").doc(String(s)).get();
        if (d.exists) docs[s] = d.data();
      } catch (e) {
        // Network/firestore failures fall through to public source fallback.
        console.warn(`[quran] local doc read failed for surah ${s}: ${e?.message || e}`);
      }
    }));
    localSource = sourceLabelForDocs(docs, surahNums);
    for (const verse of verses) {
      const found = docs[Number(verse.surah)]?.verses?.find((x) => Number(x.ayah) === Number(verse.ayah));
      if (found?.arabic) {
        const draftWords = verse.words;
        verse.arabic = found.arabic;
        if (found.transliteration) verse.transliteration = found.transliteration;
        if (found.translation && !verse.translation) verse.translation = found.translation;
        if (found.words?.length) verse.words = mergeWordGlosses(found.words, draftWords);
        verse.audioUrl = found.audioUrl || verse.audioUrl;
        verse.__verified = true;
        localCovered += 1;
      }
    }
  }
  if (localCovered === verses.length) {
    verses.forEach((v) => delete v.__verified);
    content.quran.textSource = localSource;
    return content;
  }

  let anyFailed = false;
  let anyOk = localCovered > 0;
  for (const verse of verses) {
    if (verse.__verified) continue;
    if (!verse.surah || !verse.ayah) {
      anyFailed = true;
      continue;
    }
    try {
      const draftWords = verse.words;
      const v = await fetchVerse({ surah: verse.surah, ayah: verse.ayah, fetchImpl });
      verse.arabic = v.arabic || verse.arabic;
      if (v.transliteration) verse.transliteration = v.transliteration;
      if (v.translation && !verse.translation) verse.translation = v.translation;
      if (v.words?.length) verse.words = mergeWordGlosses(v.words, draftWords);
      verse.audioUrl = v.audioUrl || verse.audioUrl;
      anyOk = true;
    } catch {
      anyFailed = true;
    }
  }
  verses.forEach((v) => delete v.__verified);
  content.quran.textSource = anyOk && !anyFailed ? "alquran.cloud" : anyOk ? "partial" : "ai_unverified";
  return content;
}
