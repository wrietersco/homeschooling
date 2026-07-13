import { test } from "node:test";
import assert from "node:assert/strict";
import { pool, isQuotaError, isRetryableTtsError, gentlePassDue, providerDue, planPassDue, qaidaTtsPayload } from "../platform/qaidaImport.js";

const HOUR = 60 * 60 * 1000;

test("gentlePassDue: a fresh/never-voiced queued job is due immediately", () => {
  const now = 1e12; // realistic Date.now() magnitude — far past one interval from 0
  assert.equal(gentlePassDue({ status: "queued" }, now), true);
  assert.equal(gentlePassDue({ status: "queued", lastVoicedAtMs: 0 }, now), true);
});

test("gentlePassDue: not due until the pacing interval (≥2h) has elapsed", () => {
  const now = 100 * HOUR;
  // 1h ago → still within the interval → not due (keeps us under the daily limit)
  assert.equal(gentlePassDue({ status: "queued", lastVoicedAtMs: now - 1 * HOUR }, now), false);
  // 3h ago → past the interval → due again
  assert.equal(gentlePassDue({ status: "queued", lastVoicedAtMs: now - 3 * HOUR }, now), true);
});

test("gentlePassDue: only a 'queued' job is ever due (running/paused/done are not)", () => {
  const old = { lastVoicedAtMs: 0 };
  assert.equal(gentlePassDue({ status: "running", ...old }, 1e12), false);
  assert.equal(gentlePassDue({ status: "done", ...old }, 1e12), false);
  assert.equal(gentlePassDue({ status: "cancelled", ...old }, 1e12), false);
  assert.equal(gentlePassDue(null, 1e12), false);
});

test("quota/429 errors are detected and NOT retried in-pass", () => {
  const q = new Error('Gemini TTS 429: {"error":{"message":"You exceeded your current quota"}}');
  assert.equal(isQuotaError(q), true);
  assert.equal(isRetryableTtsError(q), false); // a quota wall won't clear in seconds
});

test("'no audio' flakiness + 5xx/network ARE retried, but not quota", () => {
  assert.equal(isRetryableTtsError(new Error("Gemini TTS returned no audio")), true);
  assert.equal(isRetryableTtsError(new Error("Gemini TTS 503: unavailable")), true);
  assert.equal(isRetryableTtsError(new Error("The operation was aborted due to timeout")), true);
  assert.equal(isRetryableTtsError(new Error("ECONNRESET")), true);
  // a 400 (bad input) is neither quota nor retryable — fail it fast
  assert.equal(isRetryableTtsError(new Error("Gemini TTS 400: invalid argument")), false);
});

test("pool processes every item exactly once", async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const seen = [];
  await pool(items, 6, async (n) => { seen.push(n); });
  assert.equal(seen.length, 50);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test("pool never exceeds the concurrency bound", async () => {
  let inFlight = 0, peak = 0;
  const items = Array.from({ length: 40 }, (_, i) => i);
  await pool(items, 6, async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
  });
  assert.ok(peak <= 6, `peak concurrency ${peak} exceeded 6`);
  assert.ok(peak > 1, "expected real parallelism, ran serially");
});

test("pool handles an empty list without spawning workers", async () => {
  let calls = 0;
  await pool([], 6, async () => { calls += 1; });
  assert.equal(calls, 0);
});

// ─── Multi-provider pacing (plan-driven distribution) ─────────────────────────
test("providerDue: OpenAI runs every pass; Gemini-only keeps the gentle ≥2h cadence", () => {
  const now = 100 * HOUR;
  const recent = { providerLastVoicedMs: { gemini: now - 1 * HOUR, openai: now - 1 * HOUR } };
  // Gemini-only mode → Gemini gated at 2h (1h ago is too soon), OpenAI N/A here.
  assert.equal(providerDue("gemini", { plan: { mode: "gemini" }, ...recent }, now), false);
  assert.equal(providerDue("gemini", { plan: { mode: "gemini" }, providerLastVoicedMs: { gemini: now - 3 * HOUR } }, now), true);
  // OpenAI always due regardless of recency.
  assert.equal(providerDue("openai", { plan: { mode: "openai" }, ...recent }, now), true);
});

test("providerDue: in distribute mode Gemini also runs every pass (no 2h gate)", () => {
  const now = 100 * HOUR;
  const job = { plan: { mode: "distribute" }, providerLastVoicedMs: { gemini: now - 1, openai: now - 1 } };
  assert.equal(providerDue("gemini", job, now), true);
  assert.equal(providerDue("openai", job, now), true);
});

test("providerDue: a legacy numeric lastVoicedAtMs counts as Gemini's timestamp", () => {
  const now = 100 * HOUR;
  // No providerLastVoicedMs object — fall back to the legacy numeric field for Gemini.
  assert.equal(providerDue("gemini", { plan: { mode: "gemini" }, lastVoicedAtMs: now - 1 * HOUR }, now), false);
  assert.equal(providerDue("gemini", { plan: { mode: "gemini" }, lastVoicedAtMs: now - 3 * HOUR }, now), true);
});

// ─── Pure-Arabic steering for every provider/model ────────────────────────────
test("qaidaTtsPayload: spoken text is pure Arabic for every provider (no Latin)", () => {
  const item = { glyph: "بَ" }; // single glyph → jor-tor + glyph twice
  const g = qaidaTtsPayload(item, "gemini", "gemini-2.5-flash-preview-tts");
  const o = qaidaTtsPayload(item, "openai", "gpt-4o-mini-tts");
  // Gemini: Arabic-language directive leads as a style cue (not spoken), then Arabic script.
  assert.match(g.text, /العربية/); // directive is in Arabic
  assert.ok(!/[A-Za-z]/.test(g.text.split("\n\n")[0]), `Gemini directive must be Latin-free: ${g.text}`);
  assert.match(g.text, /ب زبر بَ ، بَ ، بَ$/);
  assert.equal(g.instructions, "");
  // OpenAI 4o: clean pure-Arabic spoken text (zero Latin letters); Arabic directive steers.
  assert.equal(o.text, "ب زبر بَ ، بَ ، بَ");
  assert.ok(!/[A-Za-z]/.test(o.text), `OpenAI spoken text must be Latin-free: ${o.text}`);
  assert.match(o.instructions, /العربية/); // directive is in Arabic
});

test("qaidaTtsPayload: directive asks for jor-tor then the complete word via الكلمة الكاملة: cue", () => {
  const item = { glyph: "بَ" };
  const o = qaidaTtsPayload(item, "openai", "gpt-4o-mini-tts");
  assert.match(o.instructions, /تقطيع/);             // spell each letter (jor tor)
  assert.match(o.instructions, /الكلمة الكاملة:/);   // explicit cue matching the text format
  assert.match(o.instructions, /لا تقطّعها/);         // "do not spell it out"
});

test("qaidaTtsPayload: TTS text is jor-tor → الكلمة الكاملة: word → word again (three segments)", () => {
  // Multi-letter: jor-tor then word twice
  const item = { glyph: "قَلْبْ" };
  const o = qaidaTtsPayload(item, "openai", "gpt-4o-mini-tts");
  assert.equal(o.text, "ق زبر قَ ، ل جزم لْ ، ب جزم بْ ، الكلمة الكاملة: قَلْبْ ، قَلْبْ");
  assert.ok(!/[A-Za-z]/.test(o.text), `spoken text must be Latin-free: ${o.text}`);
  // Single glyph: jor-tor then bare glyph twice (consistent three-segment format)
  const single = qaidaTtsPayload({ glyph: "بَ" }, "openai", "gpt-4o-mini-tts");
  assert.equal(single.text, "ب زبر بَ ، بَ ، بَ");
});

test("qaidaTtsPayload: legacy OpenAI models (tts-1 / tts-1-hd) get pure-Arabic text and NO instructions field", () => {
  const item = { glyph: "بَ" };
  for (const model of ["tts-1", "tts-1-hd"]) {
    const o = qaidaTtsPayload(item, "openai", model, "speak slower");
    assert.equal(o.text, "ب زبر بَ ، بَ ، بَ"); // all-Arabic text with word repeated — their only steer
    assert.equal(o.instructions, ""); // field they reject is never attached (keeps cache honest)
  }
});

test("qaidaTtsPayload: a per-take instruction folds into the directive, never the spoken text", () => {
  const item = { glyph: "بَ" };
  const o = qaidaTtsPayload(item, "openai", "gpt-4o-mini-tts", "speak slower");
  assert.equal(o.text, "ب زبر بَ ، بَ ، بَ");  // spoken text stays clean (word repeated)
  assert.match(o.instructions, /speak slower/);  // cue rides the steering field
  const g = qaidaTtsPayload(item, "gemini", "gemini-2.5-flash-preview-tts", "speak slower");
  assert.match(g.text, /speak slower/);           // Gemini folds it into the leading cue
  assert.match(g.text, /ب زبر بَ ، بَ ، بَ$/);
});

test("planPassDue: only a queued job with at least one due provider is due", () => {
  const now = 100 * HOUR;
  // OpenAI lane → always due when queued.
  assert.equal(planPassDue({ status: "queued", plan: { mode: "openai" } }, now), true);
  // Running/done are never due.
  assert.equal(planPassDue({ status: "running", plan: { mode: "openai" } }, now), false);
  // Gemini-only, voiced 1h ago → not due yet.
  assert.equal(planPassDue({ status: "queued", plan: { mode: "gemini" }, providerLastVoicedMs: { gemini: now - 1 * HOUR } }, now), false);
  // Distribute with a recent OpenAI call still due (OpenAI ungated).
  assert.equal(planPassDue({ status: "queued", plan: { mode: "distribute" }, providerLastVoicedMs: { gemini: now, openai: now } }, now), true);
});
