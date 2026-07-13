import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceText, priceTts, priceImage, priceEvent, periodKeys,
  recordCostEvent, _resetPricingCache, DEFAULT_PRICING,
} from "../lib/costMeter.js";
import { parseUsage } from "../agents/llm.js";

// ─── parseUsage ────────────────────────────────────────────────────────────────
test("parseUsage maps Gemini usageMetadata to a stable shape", () => {
  const u = parseUsage({ promptTokenCount: 1200, candidatesTokenCount: 340, thoughtsTokenCount: 50, totalTokenCount: 1590 });
  assert.deepEqual(u, { inputTokens: 1200, outputTokens: 340, thoughtTokens: 50, totalTokens: 1590 });
});

test("parseUsage returns zeros when usage is absent", () => {
  assert.deepEqual(parseUsage(undefined), { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 });
});

// ─── Pricing math ──────────────────────────────────────────────────────────────
test("priceText prices input + output at the model's rate", () => {
  const { costUsd } = priceText({ model: "gemini-2.5-flash", usage: { inputTokens: 1000, outputTokens: 500 } });
  // (1000*0.30 + 500*2.50) / 1e6
  assert.equal(costUsd, 0.00155);
});

test("priceText bills thinking tokens at the output rate", () => {
  const { costUsd } = priceText({ model: "gemini-2.5-flash", usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 1000 } });
  assert.equal(costUsd, 0.0025); // 1000 * 2.50 / 1e6
});

test("priceText falls back to a default rate for an unknown model", () => {
  const { costUsd } = priceText({ model: "made-up-model", usage: { inputTokens: 1000, outputTokens: 0 } });
  assert.equal(costUsd, 0.0003); // fallback input 0.30
});

test("priceTts prefers real token usage", () => {
  const { costUsd } = priceTts({ model: "gemini-2.5-flash-preview-tts", usage: { inputTokens: 10, outputTokens: 250 } });
  assert.equal(costUsd, 0.002505); // (10*0.50 + 250*10) / 1e6
});

test("priceTts falls back to audioSeconds → tokens (25/sec)", () => {
  const { costUsd } = priceTts({ model: "gemini-2.5-flash-preview-tts", usage: { audioSeconds: 4 } });
  assert.equal(costUsd, 0.001); // 100 tokens * 10 / 1e6
});

test("priceImage charges per image", () => {
  const { costUsd } = priceImage({ model: "gemini-2.5-flash-image", usage: { images: 3 } });
  assert.equal(costUsd, 0.117); // 3 * 0.039
});

test("priceEvent dispatches by kind", () => {
  assert.equal(priceEvent({ kind: "image", model: "gemini-2.5-flash-image", usage: { images: 1 } }).costUsd, 0.039);
  assert.equal(priceEvent({ kind: "tts", model: "gemini-2.5-flash-preview-tts", usage: { audioSeconds: 1 } }).costUsd, 0.00025);
  assert.equal(priceEvent({ kind: "text", model: "gemini-2.5-flash", usage: { inputTokens: 1000, outputTokens: 0 } }).costUsd, 0.0003);
});

// ─── Period keys ───────────────────────────────────────────────────────────────
test("periodKeys derives UTC month and day", () => {
  const { month, day } = periodKeys(new Date("2026-06-21T10:30:00Z"));
  assert.equal(month, "2026-06");
  assert.equal(day, "2026-06-21");
});

// ─── recordCostEvent: writes event + 3 rollups in one batch ──────────────────────
function fakeDb() {
  const writes = [];
  const doc = (path) => ({
    _path: path,
    collection: (c) => coll(`${path}/${c}`),
    get: async () => ({ exists: false, data: () => ({}) }),
  });
  const coll = (path) => ({
    _path: path,
    doc: (id) => doc(`${path}/${id ?? "<auto>"}`),
  });
  return {
    writes,
    collection: (c) => coll(c),
    batch: () => ({
      set: (ref, data, opts) => writes.push({ path: ref._path, data, opts }),
      commit: async () => {},
    }),
  };
}

test("recordCostEvent writes a deep event doc plus 3 rollups", async () => {
  _resetPricingCache();
  const db = fakeDb();
  const out = await recordCostEvent(db, {
    familyId: "famA", kind: "text", agentKey: "guide", model: "gemini-2.5-flash",
    source: "askGuide", uid: "u1", usage: { inputTokens: 1000, outputTokens: 500 },
  });

  assert.equal(out.costUsd, 0.00155);
  assert.equal(db.writes.length, 4); // event + family-month + family-day + platform-month

  const [eventW, famMonth, famDay, platMonth] = db.writes;
  // Deep event doc carries the computed cost as a plain number + the rate snapshot.
  assert.match(eventW.path, /families\/famA\/costEvents\//);
  assert.equal(eventW.data.costUsd, 0.00155);
  assert.equal(eventW.data.agentKey, "guide");
  assert.equal(eventW.data.model, "gemini-2.5-flash");
  assert.deepEqual(eventW.data.rateSnapshot, DEFAULT_PRICING.text["gemini-2.5-flash"]);
  assert.equal(eventW.data.uid, "u1");

  // Rollups are merge-set counter docs keyed by period.
  assert.match(famMonth.path, /families\/famA\/costRollups\/\d{4}-\d{2}$/);
  assert.equal(famMonth.opts.merge, true);
  assert.match(famDay.path, /families\/famA\/costRollups\/\d{4}-\d{2}-\d{2}$/);
  assert.equal(platMonth.path.startsWith("platformCostRollups/"), true);
  // Platform rollup tracks per-family breakdown.
  assert.ok(platMonth.data.byFamily.famA);
});

test("recordCostEvent no-ops without a familyId", async () => {
  const db = fakeDb();
  const out = await recordCostEvent(db, { kind: "text", model: "gemini-2.5-flash", usage: {} });
  assert.equal(out, null);
  assert.equal(db.writes.length, 0);
});
