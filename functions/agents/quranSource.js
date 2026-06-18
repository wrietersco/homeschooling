// Verified Quran text source — Quran Foundation Content API (api.quran.foundation).
//
// The activity agent decides WHICH verses an activity covers (surah:ayah), but
// the canonical Arabic text, word-by-word splits, transliteration, and audio
// must come from a verified source — never an LLM. This module fetches that
// authoritative data and overwrites the agent's draft text.
//
// Auth: OAuth2 client_credentials (scope=content). Credentials come from the
// QURAN_CLIENT_ID / QURAN_CLIENT_SECRET secrets. Pre-live endpoints are used;
// swap the two base URLs for production when the prod client is issued.
//
// Network is best-effort: any failure leaves the agent's draft text in place
// and marks the content `textSource: 'ai_unverified'` so the UI can flag it.

const OAUTH_URL = "https://prelive-oauth2.quran.foundation/oauth2/token";
const API_BASE = "https://apis-prelive.quran.foundation/content/api/v4";
const WBW_AUDIO_BASE = "https://audio.qurancdn.com/";

const pad3 = (n) => String(n).padStart(3, "0");
const ayahRecitationUrl = (surah, ayah) =>
  `https://everyayah.com/data/Alafasy_128kbps/${pad3(surah)}${pad3(ayah)}.mp3`;

let cachedToken = null; // { token, expiresAt }

export function isConfigured() {
  return Boolean(process.env.QURAN_CLIENT_ID && process.env.QURAN_CLIENT_SECRET);
}

async function getToken(fetchImpl) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const clientId = process.env.QURAN_CLIENT_ID;
  const clientSecret = process.env.QURAN_CLIENT_SECRET;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchImpl(OAUTH_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=content",
  });
  if (!res.ok) throw new Error(`Quran OAuth ${res.status}`);
  const j = await res.json();
  cachedToken = { token: j.access_token, expiresAt: Date.now() + ((j.expires_in || 3600) * 1000) };
  return cachedToken.token;
}

// Fetch one verse's canonical data. Returns { arabic, transliteration, words, audioUrl }.
export async function fetchVerse({ surah, ayah, fetchImpl = globalThis.fetch }) {
  const token = await getToken(fetchImpl);
  const clientId = process.env.QURAN_CLIENT_ID;
  const url = `${API_BASE}/verses/by_key/${surah}:${ayah}?words=true&word_fields=text_uthmani,transliteration&fields=text_uthmani`;
  const res = await fetchImpl(url, { headers: { "x-auth-token": token, "x-client-id": clientId } });
  if (!res.ok) throw new Error(`Quran API ${res.status}`);
  const v = (await res.json()).verse;
  if (!v) throw new Error("Quran API: empty verse");

  const words = (v.words || [])
    .filter((w) => w.char_type_name === "word")
    .map((w) => ({
      arabic: w.text_uthmani || w.text || "",
      transliteration: w.transliteration?.text || "",
      audioUrl: w.audio_url ? WBW_AUDIO_BASE + w.audio_url : "",
    }))
    .filter((w) => w.arabic);

  return {
    arabic: v.text_uthmani || "",
    transliteration: words.map((w) => w.transliteration).filter(Boolean).join(" "),
    words,
    audioUrl: ayahRecitationUrl(surah, ayah),
  };
}

// Enrich a quran_reading content object in place: replace each verse's Arabic,
// words, and audio with verified data. Keeps the LLM translation (meaning) and
// falls back to the LLM transliteration if the API has none. Sets textSource.
// Returns the (mutated) content.
export async function enrichQuranContent(content, { fetchImpl = globalThis.fetch } = {}) {
  if (!content?.quran?.verses?.length) return content;
  if (!isConfigured()) { content.quran.textSource = "ai_unverified"; return content; }

  let anyFailed = false;
  let anyOk = false;

  for (const verse of content.quran.verses) {
    if (!verse.surah || !verse.ayah) { anyFailed = true; continue; }
    try {
      const v = await fetchVerse({ surah: verse.surah, ayah: verse.ayah, fetchImpl });
      verse.arabic = v.arabic || verse.arabic;
      if (v.transliteration) verse.transliteration = v.transliteration;
      verse.audioUrl = v.audioUrl;
      if (v.words.length) verse.words = v.words; // canonical splits + per-word audio
      anyOk = true;
    } catch {
      anyFailed = true; // leave the draft text for this verse
    }
  }

  content.quran.textSource = anyOk && !anyFailed ? "quran.foundation"
    : anyOk ? "partial"
    : "ai_unverified";
  return content;
}
