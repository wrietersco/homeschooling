import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TTS_LIMITS, limitFor, estimateTtsCost, splitByRate,
  activeProviders, planModel, buildPlanEstimate,
} from "../platform/qaidaCost.js";

// ─── limits ───────────────────────────────────────────────────────────────────
test("limitFor returns seeded limits and a per-provider fallback", () => {
  assert.deepEqual(limitFor("gemini", "gemini-2.5-flash-preview-tts"), { rpm: 10, rpd: 100 });
  assert.deepEqual(limitFor("openai", "gpt-4o-mini-tts"), { rpm: 50, rpd: null });
  // Unknown model → provider default.
  assert.deepEqual(limitFor("openai", "mystery-tts"), { rpm: 50, rpd: null });
  assert.deepEqual(limitFor("gemini", "mystery-tts"), { rpm: 10, rpd: 100 });
  assert.ok(DEFAULT_TTS_LIMITS.openai["tts-1"]);
});

// ─── cost estimate ──────────────────────────────────────────────────────────
test("estimateTtsCost: per-character model (tts-1) bills the input characters", () => {
  // 10 words, 150 chars total on tts-1 ($15 / 1M chars).
  assert.equal(estimateTtsCost({ items: 10, chars: 150, model: "tts-1" }), (150 / 1e6) * 15);
  assert.equal(estimateTtsCost({ items: 10, chars: 150, model: "tts-1-hd" }), (150 / 1e6) * 30);
});

test("estimateTtsCost: token model (gemini flash) prices input + audio output", () => {
  const usd = estimateTtsCost({ items: 10, chars: 200, model: "gemini-2.5-flash-preview-tts" });
  // input = 200/4 = 50 tok @ $0.5/1M; output = 10*4*25 = 1000 tok @ $10/1M
  assert.equal(usd, (50 * 0.5 + 1000 * 10) / 1e6);
  assert.ok(usd > 0);
});

test("estimateTtsCost: zero items costs nothing", () => {
  assert.equal(estimateTtsCost({ items: 0, chars: 0, model: "gpt-4o-mini-tts" }), 0);
});

// ─── split ─────────────────────────────────────────────────────────────────
test("splitByRate divides proportionally and always sums back to count", () => {
  // 10 words, gemini rpm 10 vs openai rpm 50 → ~1:5.
  const s = splitByRate(10, { gemini: 10, openai: 50 });
  assert.equal(s.gemini + s.openai, 10);
  assert.equal(s.openai, 8);   // round(10*50/60)=8
  assert.equal(s.gemini, 2);   // remainder
});

test("splitByRate ignores zero/negative weights and handles empty count", () => {
  assert.deepEqual(splitByRate(10, { gemini: 0, openai: 50 }), { gemini: 0, openai: 10 });
  assert.deepEqual(splitByRate(0, { gemini: 10, openai: 50 }), { gemini: 0, openai: 0 });
  assert.deepEqual(splitByRate(10, { gemini: 0, openai: 0 }), { gemini: 0, openai: 0 });
});

// ─── plan helpers ─────────────────────────────────────────────────────────
test("activeProviders + planModel reflect the chosen mode", () => {
  assert.deepEqual(activeProviders({ mode: "gemini" }), ["gemini"]);
  assert.deepEqual(activeProviders({ mode: "openai" }), ["openai"]);
  assert.deepEqual(activeProviders({ mode: "distribute" }), ["openai", "gemini"]); // throughput-first
  assert.equal(planModel({ models: { openai: "tts-1-hd" } }, "openai"), "tts-1-hd");
  assert.equal(planModel({}, "gemini"), "gemini-2.5-flash-preview-tts"); // default
});

// ─── full plan estimate (the number the UI shows) ─────────────────────────
test("buildPlanEstimate single-provider: all items on one model", () => {
  const e = buildPlanEstimate({
    pending: { items: 10, chars: 200 },
    plan: { mode: "openai", models: { openai: "tts-1" } },
  });
  assert.equal(e.perProvider.gemini, undefined);
  assert.equal(e.perProvider.openai.items, 10);
  assert.equal(e.perProvider.openai.chars, 200);
  assert.equal(e.totalUsd, e.perProvider.openai.usd);
  assert.equal(e.totalUsd, estimateTtsCost({ items: 10, chars: 200, model: "tts-1" }));
});

test("buildPlanEstimate distribute: RPM-proportional split, total = sum of lanes", () => {
  const e = buildPlanEstimate({
    pending: { items: 10, chars: 300 },
    plan: { mode: "distribute", models: { gemini: "gemini-2.5-flash-preview-tts", openai: "gpt-4o-mini-tts" } },
  });
  // 10 split 1:5 by rpm → openai 8, gemini 2 (matches splitByRate).
  assert.equal(e.perProvider.openai.items, 8);
  assert.equal(e.perProvider.gemini.items, 2);
  // chars split proportional to items (avg 30 chars/word).
  assert.equal(e.perProvider.openai.chars, 8 * 30);
  assert.equal(e.perProvider.gemini.chars, 2 * 30);
  assert.ok(Math.abs(e.totalUsd - (e.perProvider.openai.usd + e.perProvider.gemini.usd)) < 1e-12);
  assert.ok(e.totalUsd > 0);
});

test("buildPlanEstimate with nothing pending is all-zero", () => {
  const e = buildPlanEstimate({ pending: { items: 0, chars: 0 }, plan: { mode: "distribute" } });
  assert.equal(e.totalUsd, 0);
  assert.equal(e.perProvider.openai.items, 0);
  assert.equal(e.perProvider.gemini.items, 0);
});
