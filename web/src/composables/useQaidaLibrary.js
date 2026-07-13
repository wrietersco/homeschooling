// Live Noorani Qaida audio resolver — the render-time half of the materialRef
// wiring. Qaida drill items carry a `materialRef = { collection: "nooraniQaida",
// lessonId, glyph }` plus an embedded snapshot of the audio URL taken when the
// content was generated. Audio for the full corpus is voiced slowly over days, so
// that snapshot is usually incomplete. This composable looks the glyph up LIVE in
// the shared library at play time and prefers the library's CURRENT recording, so
// an activity automatically starts playing real audio as soon as the platform
// voices that glyph — no content regeneration. Falls back to the embedded URL
// (instant first paint / offline), then to TTS. Best-effort: any read failure
// silently leaves the embedded behaviour in place.
//
// nooraniQaida is publicly readable, so this works on the unauthenticated child
// player too.
import { ref, watch } from "vue";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Session cache: lessonId -> Promise<Map(glyph -> { audioUrl, spellScript })>, so
// repeated renders / multiple components share one read per lesson.
const _lessonCache = new Map();

function fetchLessonGlyphs(lessonId) {
  if (_lessonCache.has(lessonId)) return _lessonCache.get(lessonId);
  const p = getDoc(doc(db, "nooraniQaida", lessonId))
    .then((snap) => {
      const map = new Map();
      if (snap.exists()) {
        for (const it of snap.data().items || []) {
          if (it.glyph) map.set(it.glyph, { audioUrl: it.audioUrl || null, spellScript: it.spellScript || "" });
        }
      }
      return map;
    })
    .catch(() => new Map()); // best-effort — fall back to embedded/TTS
  _lessonCache.set(lessonId, p);
  return p;
}

// For tests: drop the session cache.
export function __resetQaidaLibraryCache() { _lessonCache.clear(); }

// `contentRef` is a ref/getter for the activity content. Returns resolvers that
// prefer the live library value over the embedded snapshot.
export function useQaidaLibrary(contentRef) {
  const liveByGlyph = ref(new Map());

  async function resolve(content) {
    liveByGlyph.value = new Map();
    if (!content || content.kind !== "qaida_exercise") return;
    const lessonIds = new Set();
    for (const ex of content.exercises || []) {
      for (const it of ex.items || []) {
        const r = it.materialRef;
        if (r && r.collection === "nooraniQaida" && r.lessonId) lessonIds.add(r.lessonId);
      }
    }
    if (!lessonIds.size) return;
    const maps = await Promise.all([...lessonIds].map((id) => fetchLessonGlyphs(id)));
    const byGlyph = new Map();
    for (const m of maps) for (const [glyph, v] of m) byGlyph.set(glyph, v);
    liveByGlyph.value = byGlyph;
  }

  watch(contentRef, (c) => { resolve(c); }, { immediate: true });

  const liveFor = (it) => (it?.materialRef ? liveByGlyph.value.get(it.materialRef.glyph) : null);
  // Prefer the live library recording; else the embedded snapshot; else null (→ TTS).
  const liveAudioUrl = (it) => (liveFor(it)?.audioUrl) || it?.audioUrl || null;
  // Spell script is deterministic and set at generation time, but prefer live too.
  const liveSpellScript = (it) => (liveFor(it)?.spellScript) || it?.spellScript || "";

  return { liveByGlyph, liveAudioUrl, liveSpellScript };
}
