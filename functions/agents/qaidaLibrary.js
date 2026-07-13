// Noorani Qaida shared-library linker — the first `materialRef` wiring.
//
// The platform maintains a top-level `nooraniQaida/*` corpus of the standard
// Qaida glyphs, each carrying a deterministic spell-out script (qaidaSpell.js)
// and a curated, cached recording (importQaida + qaidaAudioWorker). A family's
// `qaida_exercise` activity authors its own drill glyphs in `content.exercises`;
// this module LINKS each drill item to the matching library glyph (by normalized
// text) so the player can hear the curated spell-out recording and show the
// canonical script, instead of TTS-ing the raw glyph.
//
// "materialRef" first slice: the item still EMBEDS its content (the matched
// audio URL + spell script are denormalized in place, so existing activities and
// the offline/token child player keep rendering with no extra read), but it ALSO
// records `materialRef = { collection, lessonId, glyph }` documenting the linkage
// for the eventual full content/material split. Best-effort throughout — a miss
// (glyph not in the corpus, library not imported, audio not yet generated) simply
// leaves the item as the agent authored it, falling back to TTS at render time.

const COLLECTION = "nooraniQaida";

// Normalize a glyph for matching: NFC + trim. The corpus stores fully-voweled
// Arabic and the content agent is instructed to do the same, so exact normalized
// equality is the right key — matching is harakat-sensitive on purpose ("بَ"
// (zabar) must not be served the recording for "بِ" (zer)).
export function normalizeGlyph(s) {
  return String(s || "").normalize("NFC").trim();
}

// Build a normalized-glyph → library-item map from raw lesson docs
// ([{ id, data }]). The first lesson (lowest `order`) wins a duplicate glyph —
// its earliest, simplest teaching context. Pure, so tests inject docs directly.
export function buildGlyphMap(lessonDocs) {
  const map = new Map();
  for (const { id, data } of lessonDocs || []) {
    for (const it of (data && data.items) || []) {
      const key = normalizeGlyph(it.glyph);
      if (!key || map.has(key)) continue;
      map.set(key, {
        lessonId: id,
        glyph: it.glyph,
        spellScript: it.spellScript || "",
        translit: it.translit || "",
        audioUrl: it.audioUrl || null,
      });
    }
  }
  return map;
}

// Short-lived module cache of the glyph map so back-to-back content generations
// in one warm instance don't re-read the whole corpus, while a re-import or a
// fresh audio run still becomes visible within the TTL.
const MAP_TTL_MS = 5 * 60 * 1000;
let _mapCache = null;
let _mapCachedAt = 0;

// For tests: drop the module cache.
export function __resetQaidaLibraryCache() { _mapCache = null; _mapCachedAt = 0; }

async function loadGlyphMap(db) {
  if (_mapCache && Date.now() - _mapCachedAt < MAP_TTL_MS) return _mapCache;
  const snap = await db.collection(COLLECTION).orderBy("order").get();
  _mapCache = buildGlyphMap(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
  _mapCachedAt = Date.now();
  return _mapCache;
}

// Link a single drill item to the library in place. Returns true when matched.
export function linkQaidaItem(item, glyphMap) {
  if (!item || !item.text || !glyphMap) return false;
  const hit = glyphMap.get(normalizeGlyph(item.text));
  if (!hit) return false;
  item.materialRef = { collection: COLLECTION, lessonId: hit.lessonId, glyph: hit.glyph };
  if (hit.spellScript) item.spellScript = hit.spellScript;
  // Prefer the curated recording; render-time fallback to TTS stays in place.
  if (hit.audioUrl) item.audioUrl = hit.audioUrl;
  // Backfill transliteration from the canonical natural word only if the agent
  // left it blank — never overwrite a draft gloss.
  if (!item.transliteration && hit.translit) item.transliteration = hit.translit;
  return true;
}

// Enrich a captured `qaida_exercise` payload: link every drill item to the
// shared library where its glyph matches. Best-effort; never throws. Pass a
// prebuilt `glyphMap` in tests, or `db` to load (and cache) it from Firestore.
export async function enrichQaidaContent(content, { db, glyphMap } = {}) {
  if (!content || content.kind !== "qaida_exercise") return { linked: 0, total: 0 };
  const map = glyphMap || (db ? await loadGlyphMap(db) : null);
  if (!map || map.size === 0) return { linked: 0, total: 0 };
  let linked = 0, total = 0;
  for (const ex of content.exercises || []) {
    for (const it of ex.items || []) {
      total += 1;
      if (linkQaidaItem(it, map)) linked += 1;
    }
  }
  return { linked, total };
}
