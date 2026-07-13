import { test } from "node:test";
import assert from "node:assert/strict";
import { spellOut } from "../agents/qaidaSpell.js";
import { STANDARD_QAIDA_LESSONS, TOTAL_QAIDA_LESSONS, TOTAL_QAIDA_ITEMS } from "../agents/qaidaCorpus.js";

test("corpus has the standard lessons in ascending order with unique ids", () => {
  assert.equal(STANDARD_QAIDA_LESSONS.length, TOTAL_QAIDA_LESSONS);
  const ids = new Set();
  let lastOrder = 0;
  for (const lesson of STANDARD_QAIDA_LESSONS) {
    assert.ok(!ids.has(lesson.id), `duplicate lesson id ${lesson.id}`);
    ids.add(lesson.id);
    assert.ok(lesson.order >= lastOrder, "lessons must be ordered");
    lastOrder = lesson.order;
    assert.ok(lesson.glyphs.length > 0, `lesson ${lesson.id} has no glyphs`);
  }
});

test("every lesson carries syllabus-facing meta (repeatable + frequency + complexity)", () => {
  for (const lesson of STANDARD_QAIDA_LESSONS) {
    assert.equal(lesson.meta.repeatable, true, `${lesson.id} should be repeatable (memorisation)`);
    assert.ok(lesson.meta.repeatFrequency, `${lesson.id} missing repeatFrequency`);
    assert.equal(typeof lesson.meta.complexity, "number", `${lesson.id} missing complexity`);
  }
});

test("every glyph in the corpus produces a non-empty spell script", () => {
  for (const lesson of STANDARD_QAIDA_LESSONS) {
    for (const glyph of lesson.glyphs) {
      const { script } = spellOut(glyph);
      assert.ok(script && script.length > 0, `empty script for "${glyph}" in ${lesson.id}`);
    }
  }
});

test("the corpus is the complete standard size, not a sample", () => {
  // Systematic coverage (every voiced letter × every mark + the standard lesson
  // set) should land in the several-hundred range, not ~150.
  assert.ok(TOTAL_QAIDA_ITEMS > 400, `expected a complete corpus, got ${TOTAL_QAIDA_ITEMS}`);
  // harakat lessons must cover every voiced letter (27), not a handful.
  const byId = Object.fromEntries(STANDARD_QAIDA_LESSONS.map((l) => [l.id, l]));
  assert.ok(byId["03-zabar"].glyphs.length >= 27);
  assert.ok(byId["06-tanween"].glyphs.length >= 27 * 3);
  assert.ok(byId["07-madd"].glyphs.length >= 27 * 3);
});

test("madd lesson glyphs voice an elongated (Madd) callout", () => {
  const madd = STANDARD_QAIDA_LESSONS.find((l) => l.id === "07-madd");
  assert.ok(madd.glyphs.some((g) => /Madd/.test(spellOut(g).script)));
});

test("harakat lessons name their mark in the script (Zabar/Zer/Pesh)", () => {
  const byId = Object.fromEntries(STANDARD_QAIDA_LESSONS.map((l) => [l.id, l]));
  assert.match(spellOut(byId["03-zabar"].glyphs[0]).script, /Zabar/);
  assert.match(spellOut(byId["04-zer"].glyphs[0]).script, /Zer/);
  assert.match(spellOut(byId["05-pesh"].glyphs[0]).script, /Pesh/);
});

test("jazm and tashdeed lessons surface their concept in the script", () => {
  const byId = Object.fromEntries(STANDARD_QAIDA_LESSONS.map((l) => [l.id, l]));
  assert.ok(byId["10-jazm"].glyphs.some((g) => /Jazm/.test(spellOut(g).script)));
  assert.ok(byId["11-tashdeed"].glyphs.some((g) => /Tashdeed/.test(spellOut(g).script)));
});
