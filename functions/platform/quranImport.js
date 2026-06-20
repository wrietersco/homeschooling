// One-time full-Quran import (superadmin). Populates a shared top-level
// `quran/{surahNumber}` collection with Arabic, translation, transliteration,
// word tokens, and recitation URLs from public no-key Quran sources.
//
// Idempotent + resumable: each call imports a batch of not-yet-present surahs
// and returns how many remain, so the Platform UI can loop until done.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { fetchPublicQuranBundle, isConfigured, publicQuranSourceMeta } from "../agents/quranSource.js";

const TOTAL_SURAHS = 114;

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
}

// Status: how much of the Quran is imported.
export const getQuranStatus = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const snap = await db.collection("quran").get();
  let verses = 0;
  snap.forEach((d) => { verses += Number(d.data().ayahCount || d.data().verses?.length || 0); });
  return {
    configured: isConfigured(),
    provider: "public-no-key",
    source: "alquran.cloud",
    importedSurahs: snap.size,
    totalSurahs: TOTAL_SURAHS,
    verses,
    done: snap.size >= TOTAL_SURAHS,
  };
});

// Import a batch of surahs. Returns { imported, importedSurahs, remaining, done }.
export const importQuran = onCall(
  { timeoutSeconds: 540 },
  async (request) => {
    requireSuperAdmin(request);
    const db = getFirestore();
    const force = Boolean(request.data?.force);
    const offset = Math.max(0, Number(request.data?.offset) || 0);
    const limit = Math.min(20, Math.max(1, Number(request.data?.limit) || 8));

    const existing = new Set();
    const existingSnap = await db.collection("quran").get();
    existingSnap.forEach((d) => existing.add(Number(d.id)));

    const chapters = await fetchPublicQuranBundle({});
    const todo = force
      ? chapters.slice(offset, offset + limit)
      : chapters.filter((c) => !existing.has(c.id)).slice(0, limit);
    const sourceMeta = publicQuranSourceMeta();

    let imported = 0;
    const failed = [];
    for (const ch of todo) {
      try {
        await db.collection("quran").doc(String(ch.id)).set({
          surah: ch.id,
          nameSimple: ch.nameSimple,
          nameArabic: ch.nameArabic,
          englishName: ch.englishName,
          englishNameTranslation: ch.englishNameTranslation,
          revelationType: ch.revelationType,
          ayahCount: ch.versesCount || ch.verses.length,
          chapterAudioUrl: ch.chapterAudioUrl,
          verses: ch.verses,
          ...sourceMeta,
          importedAt: new Date(),
        });
        existing.add(ch.id);
        imported += 1;
      } catch (e) {
        failed.push({ surah: ch.id, error: e?.message || "Import failed" });
      }
    }

    const nextOffset = force ? Math.min(TOTAL_SURAHS, offset + todo.length) : null;
    const importedSurahs = existing.size;
    const remaining = force
      ? Math.max(0, TOTAL_SURAHS - nextOffset)
      : Math.max(0, TOTAL_SURAHS - importedSurahs);
    return {
      configured: true,
      provider: "public-no-key",
      source: "alquran.cloud",
      imported,
      importedSurahs,
      processedSurahs: force ? nextOffset : importedSurahs,
      nextOffset,
      remaining,
      done: remaining <= 0,
      failed,
    };
  }
);
