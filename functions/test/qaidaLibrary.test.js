import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGlyph,
  buildGlyphMap,
  linkQaidaItem,
  enrichQaidaContent,
} from "../agents/qaidaLibrary.js";

// A small fake corpus: two lessons, one glyph carrying audio, one without, plus a
// duplicate glyph in a later lesson to prove the earliest lesson wins.
const LESSON_DOCS = [
  {
    id: "l1-letters",
    data: {
      order: 1,
      items: [
        { glyph: "بَ", translit: "Ba", spellScript: "Bay Zabar Ba", audioUrl: "https://cdn/ba.wav" },
        { glyph: "تِ", translit: "Ti", spellScript: "Tay Zer Ti", audioUrl: null },
      ],
    },
  },
  {
    id: "l2-joined",
    data: {
      order: 2,
      // Duplicate of بَ — must NOT override the lesson-1 entry.
      items: [{ glyph: "بَ", translit: "Ba(2)", spellScript: "WRONG", audioUrl: "https://cdn/wrong.wav" }],
    },
  },
];

test("normalizeGlyph applies NFC + trim and is harakat-sensitive", () => {
  assert.equal(normalizeGlyph("  بَ  "), "بَ");
  assert.notEqual(normalizeGlyph("بَ"), normalizeGlyph("بِ")); // zabar ≠ zer
});

test("buildGlyphMap keys by normalized glyph, first lesson wins duplicates", () => {
  const map = buildGlyphMap(LESSON_DOCS);
  assert.equal(map.size, 2);
  const ba = map.get("بَ");
  assert.equal(ba.lessonId, "l1-letters", "earliest lesson should win the duplicate");
  assert.equal(ba.spellScript, "Bay Zabar Ba");
  assert.equal(ba.audioUrl, "https://cdn/ba.wav");
});

test("linkQaidaItem attaches materialRef + audio + script, fills blank translit", () => {
  const map = buildGlyphMap(LESSON_DOCS);
  const item = { text: "بَ", transliteration: "", en: "", ur: "", hint: "" };
  assert.equal(linkQaidaItem(item, map), true);
  assert.deepEqual(item.materialRef, { collection: "nooraniQaida", lessonId: "l1-letters", glyph: "بَ" });
  assert.equal(item.spellScript, "Bay Zabar Ba");
  assert.equal(item.audioUrl, "https://cdn/ba.wav");
  assert.equal(item.transliteration, "Ba", "blank translit should be backfilled from the library");
});

test("linkQaidaItem never overwrites a non-empty draft transliteration", () => {
  const map = buildGlyphMap(LESSON_DOCS);
  const item = { text: "بَ", transliteration: "draft-ba" };
  linkQaidaItem(item, map);
  assert.equal(item.transliteration, "draft-ba");
});

test("linkQaidaItem matches a glyph with no audio (script only, no audioUrl)", () => {
  const map = buildGlyphMap(LESSON_DOCS);
  const item = { text: "تِ", transliteration: "" };
  assert.equal(linkQaidaItem(item, map), true);
  assert.equal(item.spellScript, "Tay Zer Ti");
  assert.equal(item.audioUrl, undefined, "no library audio → leave audioUrl unset (render falls back to TTS)");
  assert.ok(item.materialRef, "still records the material reference");
});

test("linkQaidaItem returns false for an unknown glyph and mutates nothing", () => {
  const map = buildGlyphMap(LESSON_DOCS);
  const item = { text: "ﷺ", transliteration: "" };
  assert.equal(linkQaidaItem(item, map), false);
  assert.equal(item.materialRef, undefined);
  assert.equal(item.spellScript, undefined);
});

test("enrichQaidaContent links matching items across exercises and counts them", async () => {
  const content = {
    kind: "qaida_exercise",
    exercises: [
      { items: [{ text: "بَ" }, { text: "تِ" }] },
      { items: [{ text: "بَ" }, { text: "ﷺ" /* unknown */ }] },
    ],
  };
  const glyphMap = buildGlyphMap(LESSON_DOCS);
  const { linked, total } = await enrichQaidaContent(content, { glyphMap });
  assert.equal(total, 4);
  assert.equal(linked, 3);
  assert.equal(content.exercises[0].items[0].audioUrl, "https://cdn/ba.wav");
  assert.equal(content.exercises[1].items[1].materialRef, undefined);
});

test("enrichQaidaContent is a no-op for non-qaida content", async () => {
  const content = { kind: "problems", problems: [] };
  const res = await enrichQaidaContent(content, { glyphMap: buildGlyphMap(LESSON_DOCS) });
  assert.deepEqual(res, { linked: 0, total: 0 });
});

test("enrichQaidaContent is a safe no-op when the library is empty", async () => {
  const content = { kind: "qaida_exercise", exercises: [{ items: [{ text: "بَ" }] }] };
  const res = await enrichQaidaContent(content, { glyphMap: new Map() });
  assert.deepEqual(res, { linked: 0, total: 0 });
  assert.equal(content.exercises[0].items[0].audioUrl, undefined);
});
