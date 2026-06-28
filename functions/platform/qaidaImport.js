// Platform-level Noorani Qaida library (superadmin).
//
// Mirrors the shared-Quran model: a top-level `nooraniQaida/{lessonId}`
// collection generated ONCE and shared by every family, then audited by the
// superadmin. Each lesson holds items with a deterministic spell-out script
// (qaidaSpell.js) and a cached TTS audio URL. Superadmin operations:
//   importQaida          — write/refresh the corpus + scripts (no audio)
//   deleteQaidaLibrary   — wipe the corpus for a clean-slate rebuild
//   requestQaidaAudio    — enqueue the background audio job
//   stopQaidaAudio       — cancel a running audio job
//   qaidaAudioWorker     — scheduled drain (parallel synth of missing audio)
//   regenerateQaidaWord  — re-synth ONE item, optional extra instruction
// plus getQaidaStatus for the UI.
//
// Audio reuses the existing TTS pipeline (synthesizePcm + pcmToWav) and the same
// `tts-cache/{hash}.wav` Storage cache as click-to-hear, so identical scripts are
// never synthesized twice across the platform.
//
// Audio generation is a SERVER-SIDE background job (like contentBackfillWorker):
// the client enqueues platform/qaidaAudioJob and a scheduled worker drains it in
// parallel batches, voicing each script with the superadmin's TTS config. The UI
// only subscribes to the job doc for progress — closing the tab never stalls it.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { spellOut, voiceScript } from "../agents/qaidaSpell.js";
import { STANDARD_QAIDA_LESSONS, TOTAL_QAIDA_LESSONS } from "../agents/qaidaCorpus.js";
import {
  synthesizeSpeakable, pcmToWav, ttsCacheHash,
  TTS_PROVIDERS, resolveTtsProvider, effectiveTtsModel, effectiveTtsVoice, ttsModelAcceptsInstructions,
} from "../agents/tts.js";
import { loadAgentConfig } from "../agents/agentConfig.js";
import { recordTtsUsage } from "./usageDashboard.js";
import { platformTtsRemaining } from "./quota.js";
import { DEFAULT_TTS_LIMITS, limitFor, splitByRate, activeProviders, planModel } from "./qaidaCost.js";

const COLLECTION = "nooraniQaida";

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
}

// Build a lesson's items from the corpus. Each glyph carries TWO scripts:
//   spellScript — the Latin transliteration shown to learners/parents in the UI
//   ttsScript   — the pure-Arabic callout actually voiced (see voiceScript)
// The split exists because feeding the Latin spell-out to TTS makes the model
// voice the word in an English accent; the all-Arabic ttsScript fixes that.
function buildItems(lesson) {
  return lesson.glyphs.map((glyph) => {
    const { naturalWord } = spellOut(glyph);
    const arabicScript = voiceScript(glyph, { arabic: true });
    return {
      glyph,
      translit: naturalWord,
      spellScript: arabicScript,  // Arabic jor-tor callout shown in UI + activity captions
      ttsScript: arabicScript,    // same — fed to TTS (re-derived anyway at synth time)
      audioUrl: null,
    };
  });
}

// The text fed to TTS for an item — the PURE-ARABIC voice script, RE-DERIVED from
// the glyph every time so it can never fall back to a stale Latin ttsScript stored
// before this fix (the very thing that made the model voice in an English accent).
// It is the "jor tor" spell-out — each letter named with its harakat and its
// voweled glyph (e.g. "ب زبر بَ") — then "الكلمة الكاملة: <word>" so the model
// treats the final segment unambiguously as "speak this as one connected word",
// not as another spell element. The stored ttsScript/spellScript are last-resort
// fallbacks only if the glyph somehow yields nothing.
const arabicVoiceText = (item) => voiceScript(item.glyph, { arabic: true, wordLabel: true }) || item.ttsScript || item.spellScript;

// One explicit directive: speak PURE ARABIC, spell each letter, then the whole
// word. Written entirely in Arabic so no Latin token can pull the model toward an
// English accent. Delivered per-(provider, model):
//   • Gemini (any TTS model) — as a leading natural-language cue. Gemini follows a
//                              pre-content directive as a *style* instruction and
//                              does NOT speak it (same mechanism as RECITE_CUE).
//   • OpenAI gpt-4o-mini-tts — the `instructions` steering field.
//   • OpenAI tts-1 / tts-1-hd — these reject an instructions field, so it is NOT
//                              attached (attaching would 400 the call and poison the
//                              cache key); the all-Arabic spoken text is their steer.
const PURE_ARABIC_DIRECTIVE =
  "اقرأ بالعربية الفصحى الصحيحة فقط مع النطق القرآني الواضح — لا تنطق بأي لكنة أجنبية أبداً. " +
  "النص تقطيع حرف بحرف ثم الكلمة الكاملة. " +
  "انطق كل عنصر مفصول بفاصلة (،) ببطء ووضوح تام مع مخارج الحروف الصحيحة. " +
  "عند ظهور «الكلمة الكاملة:» انطق ما بعدها فوراً كلمةً عربيةً واحدةً متصلةً كاملةً ببطء — لا تقطّعها أبداً.";

// Build { text, instructions } for one item on a (provider, model), folding in an
// optional per-take instruction (regen). Gemini carries the directive (+ any
// per-take cue) as a leading style line; OpenAI keeps clean spoken text and carries
// the directive in its `instructions` field — but ONLY on a model that accepts one.
// When the model has no steering channel the directive is dropped (never spoken,
// never cached), leaving the pure-Arabic text to steer. Exported for tests.
export function qaidaTtsPayload(item, provider, model, extraInstruction = "") {
  const base = arabicVoiceText(item);
  const directive = [PURE_ARABIC_DIRECTIVE, extraInstruction].filter(Boolean).join(" ");
  if (provider === "gemini") return { text: `${directive}\n\n${base}`, instructions: "" };
  if (ttsModelAcceptsInstructions(provider, model)) return { text: base, instructions: directive };
  return { text: base, instructions: "" };
}

// ─── Status ───────────────────────────────────────────────────────────────────
export const getQaidaStatus = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).get();
  let items = 0, withAudio = 0, pendingItems = 0, pendingChars = 0;
  snap.forEach((d) => {
    for (const it of d.data().items || []) {
      items += 1;
      if (it.audioUrl) withAudio += 1;
      else { pendingItems += 1; pendingChars += (arabicVoiceText(it) || "").length; }
    }
  });
  return {
    importedLessons: snap.size,
    totalLessons: TOTAL_QAIDA_LESSONS,
    items,
    withAudio,
    audioRemaining: Math.max(0, items - withAudio),
    importDone: snap.size >= TOTAL_QAIDA_LESSONS,
    audioDone: items > 0 && withAudio >= items,
    // Feed the UI's pre-run cost estimate: how much text is still unvoiced, plus
    // the seeded per-provider rate limits used to project the distribute split.
    pending: { items: pendingItems, chars: pendingChars },
    limits: DEFAULT_TTS_LIMITS,
  };
});

// ─── Import corpus (idempotent; preserves already-synthesized audio) ──────────
export const importQaida = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const force = Boolean(request.data?.force);

  const existing = new Map();
  const snap = await db.collection(COLLECTION).get();
  snap.forEach((d) => existing.set(d.id, d.data()));

  // Preserve already-synthesized audio by GLYPH+script across the whole
  // collection, so re-importing (even after lesson ids are renumbered) doesn't
  // discard audio for an unchanged glyph.
  // Key preserved audio by glyph + the pure-Arabic VOICE text it was made from, so
  // a force re-import keeps audio only when the spoken text is unchanged. Audio
  // voiced under the old Latin-only scheme keys to a different (Latin) string than
  // the new all-Arabic callout, so it is correctly dropped and re-voiced.
  const audioByGlyph = new Map();
  for (const data of existing.values()) {
    for (const it of data.items || []) {
      if (it.audioUrl) audioByGlyph.set(`${it.glyph}|${arabicVoiceText(it)}`, { audioUrl: it.audioUrl, audioInstruction: it.audioInstruction || null });
    }
  }

  let imported = 0;
  for (const lesson of STANDARD_QAIDA_LESSONS) {
    if (existing.has(lesson.id) && !force) continue; // already present — leave intact

    const items = buildItems(lesson).map((it) => {
      const kept = audioByGlyph.get(`${it.glyph}|${arabicVoiceText(it)}`);
      return kept ? { ...it, ...kept } : it;
    });

    await db.collection(COLLECTION).doc(lesson.id).set({
      lessonId: lesson.id,
      order: lesson.order,
      title: lesson.title,
      kind: lesson.kind,
      meta: lesson.meta,
      items,
      itemCount: items.length,
      updatedAt: new Date(),
    });
    imported += 1;
  }

  // Prune orphan lessons no longer in the standard corpus (e.g. ids dropped or
  // renumbered) so the shared collection exactly mirrors the corpus.
  const corpusIds = new Set(STANDARD_QAIDA_LESSONS.map((l) => l.id));
  let pruned = 0;
  for (const id of existing.keys()) {
    if (!corpusIds.has(id)) { await db.collection(COLLECTION).doc(id).delete(); pruned += 1; }
  }

  const finalSize = (await db.collection(COLLECTION).get()).size;
  return {
    imported,
    pruned,
    importedLessons: finalSize,
    totalLessons: TOTAL_QAIDA_LESSONS,
    done: finalSize >= TOTAL_QAIDA_LESSONS,
  };
});

// ─── Delete the whole library (clean slate) ───────────────────────────────────
// Wipes every nooraniQaida/* doc so the superadmin can regenerate from scratch.
// Cached TTS audio in Storage (tts-cache/*) is intentionally left intact — it's
// shared/content-addressed, so a fresh import + audio run reuses it for free; a
// truly new take comes from regenerateQaidaWord with an instruction.
export const deleteQaidaLibrary = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).get();
  const docs = snap.docs;
  let deleted = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) { batch.delete(d.ref); deleted += 1; }
    await batch.commit();
  }
  return { deleted };
});

// ─── Audio synth + cache (shared tts-cache) ───────────────────────────────────
function downloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch with a hard timeout so a hung TTS connection can never stall the whole
// pass (with concurrency 1, one frozen request would otherwise block everything
// until the 540s function timeout, orphaning the job in "running").
function fetchWithTimeout(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(25000) });
}

// A failure worth retrying IN-PASS with backoff. We deliberately do NOT retry a
// 429/quota here: a quota wall won't clear in seconds (and retrying burns more
// requests against the per-minute limit), so we fail that item fast and let the
// next scheduled worker pass try it once the window resets. We DO retry "no
// audio" — Gemini TTS non-deterministically returns no audio for short/odd inputs
// (bare Qaida glyphs especially) and a fresh attempt usually succeeds — plus
// genuine 5xx/network blips.
export function isQuotaError(e) {
  return /\b429\b|quota|exhaust|rate.?limit|RESOURCE_EXHAUSTED/i.test(String(e?.message || e));
}
export function isRetryableTtsError(e) {
  if (isQuotaError(e)) return false;
  return /no audio|\b(500|502|503|504)\b|deadline|timeout|ECONN|ETIMEDOUT|network|unavailable/i.test(String(e?.message || e));
}

// Synthesize `text` (with backoff retries) and return a cached Storage URL.
// Identical scripts hit the shared cache used by click-to-hear TTS — no double
// spend. `provider` selects the TTS backend (gemini|openai) and is part of the
// cache key, so the same key format as synthesizeSpeech is reused.
async function synthToStorage({ provider, text, voiceName, model, apiKey, instructions = "", retries = 3 }) {
  const bucket = getStorage().bucket();
  const hash = ttsCacheHash({ provider, model, voiceName, text, instructions });
  const filePath = `tts-cache/${hash}.wav`;
  const file = bucket.file(filePath);

  const [exists] = await file.exists();
  if (exists) {
    const meta = (await file.getMetadata())[0];
    const token = meta?.metadata?.firebaseStorageDownloadTokens;
    // Cache hit → no API call, so it must not count against the daily budget.
    if (token) return { url: downloadUrl(bucket.name, filePath, token), cached: true };
  }

  const synth = TTS_PROVIDERS[provider].synth;
  let out;
  for (let attempt = 0; ; attempt++) {
    try { out = await synthesizeSpeakable(synth, { text, voiceName, model, apiKey, instructions, fetchImpl: fetchWithTimeout }); break; }
    catch (e) {
      if (attempt >= retries || !isRetryableTtsError(e)) throw e;
      await sleep(1500 * (attempt + 1) + Math.floor(Math.random() * 500)); // 1.5s,3s,4.5s + jitter
    }
  }
  const wav = pcmToWav(out.pcm, { sampleRate: out.sampleRate });
  const token = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
  await file.save(wav, {
    resumable: false,
    metadata: {
      contentType: "audio/wav",
      cacheControl: "public, max-age=31536000",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return { url: downloadUrl(bucket.name, filePath, token), cached: false };
}

// ─── Background audio job (enqueue → scheduled worker → progress doc) ─────────
const AUDIO_JOB_DOC = "qaidaAudioJob";          // platform/qaidaAudioJob
const STALE_RUNNING_MS = 5 * 60 * 1000;          // reclaim a job stuck "running" this long

// Gentle, self-managed pacing. The free Gemini TTS tier is tiny (≈100 requests/day,
// 10/minute), so instead of crawling into the wall and pausing for a manual
// restart, the worker voices only a SMALL batch per pass and waits hours between
// passes — landing around SAFE_DAILY_TARGET clips/day, comfortably under the limit,
// and AUTO-RESUMING across days with no button press. Scripts already in the shared
// tts-cache are applied for free and never count against the batch.
const VOICE_BATCH = 4;                            // Gemini real syntheses per pass (well under the 10/min cap)
const PASS_INTERVAL_MS = 2 * 60 * 60 * 1000;      // ≥2h between Gemini-only passes → gentle on the free tier
const PER_CALL_DELAY_MS = 3000;                   // small spacing inside a pass
const PENDING_SCAN_CAP = 600;                     // how many missing items to scan per pass
const SAFE_DAILY_TARGET = Math.round((24 * 60 * 60 * 1000 / PASS_INTERVAL_MS) * VOICE_BATCH); // ≈48
const PACING_MSG = `Auto-generating ~${SAFE_DAILY_TARGET} clips/day to stay under the free TTS limit — it resumes on its own, no restart needed.`;

// OpenAI is a paid, high-RPM lane (no free daily pool to ration), so it runs every
// scheduled pass with a larger batch — the corpus drains in minutes, not days. The
// batch is sized so even the 120s primer pass finishes within its timeout.
const OPENAI_PASS_BATCH = 20;                     // syntheses per pass
const OPENAI_PER_CALL_DELAY_MS = 1300;            // ≈46/min, under the 50 RPM Tier-1 cap
const PACING_MSG_FAST = "Voicing in fast batches via the paid provider — usually done within minutes.";

// ─── Bulk-run plan (which provider(s)/model(s) to voice with) ──────────────────
// Stored on the job doc. mode: "gemini" | "openai" | "distribute". `maxWords` caps
// a run (used for safe test runs). Falls back to the global TTS LLM config.
function sanitizeQaidaPlan(raw = {}) {
  const mode = ["gemini", "openai", "distribute"].includes(raw.mode) ? raw.mode : "gemini";
  const pick = (v, d) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : d);
  const maxWords = Number(raw.maxWords);
  return {
    mode,
    models: {
      gemini: pick(raw.models?.gemini, "gemini-2.5-flash-preview-tts"),
      openai: pick(raw.models?.openai, "gpt-4o-mini-tts"),
    },
    maxWords: Number.isFinite(maxWords) && maxWords > 0 ? Math.floor(maxWords) : null,
  };
}

// When an older job has no plan, derive one from the global TTS config so the
// worker keeps behaving exactly as before (single configured provider).
function planFromConfig(cfg) {
  const provider = resolveTtsProvider(cfg.provider);
  return sanitizeQaidaPlan({
    mode: provider,
    models: { [provider]: cfg.model },
  });
}

// Per-provider last-synthesis timestamp (object form on new jobs; a legacy numeric
// lastVoicedAtMs is treated as Gemini's, preserving back-compat for in-flight jobs).
function lastVoicedFor(job, provider) {
  const v = job?.providerLastVoicedMs;
  if (v && typeof v === "object") return Number(v[provider]) || 0;
  return provider === "gemini" ? Number(job?.lastVoicedAtMs) || 0 : 0;
}

// Is a given provider due to voice this pass? OpenAI (and Gemini in distribute
// mode) run every pass; Gemini in single mode keeps the gentle ≥2h cadence so a
// pure-Gemini run never overruns the free tier.
export function providerDue(provider, job, nowMs = Date.now()) {
  const mode = job?.plan?.mode || "gemini";
  const interval = provider === "gemini" && mode === "gemini" ? PASS_INTERVAL_MS : 0;
  return nowMs - lastVoicedFor(job, provider) >= interval;
}

// Plan-aware "is a pass due" — true when the job is queued and at least one of its
// active providers is due. Supersedes gentlePassDue for plan-driven jobs.
export function planPassDue(job, nowMs = Date.now()) {
  if (!job || job.status !== "queued") return false;
  return activeProviders(job.plan || { mode: "gemini" }).some((p) => providerDue(p, job, nowMs));
}

function audioJobRef(db) {
  return db.collection("platform").doc(AUDIO_JOB_DOC);
}

// Is a voicing pass due? Only when the job is queued AND at least PASS_INTERVAL_MS
// has elapsed since the last real synthesis (or it never ran). This is the whole
// rate limiter — the scheduled worker fires every minute but no-ops until due.
// Pure — exported for tests.
export function gentlePassDue(job, nowMs = Date.now()) {
  if (!job || job.status !== "queued") return false;
  return nowMs - (Number(job.lastVoicedAtMs) || 0) >= PASS_INTERVAL_MS;
}

// Count audio coverage across the corpus.
async function countAudio(db) {
  const snap = await db.collection(COLLECTION).get();
  let total = 0, withAudio = 0;
  snap.forEach((d) => {
    const list = d.data().items || [];
    total += list.length;
    withAudio += list.filter((i) => i.audioUrl).length;
  });
  return { total, withAudio, remaining: Math.max(0, total - withAudio) };
}

// Run `fn` over `items` with at most `size` in flight at once. Exported for tests.
export async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

// Enqueue (or resume) the audio job, then voice a small PRIMER batch inline so
// the user sees immediate movement; the scheduled worker drains the rest. The
// secret + longer timeout cover the primer pass.
export const requestQaidaAudio = onCall({ secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"], timeoutSeconds: 120 }, async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  // The bulk-run plan: which provider(s)/model(s) to voice with, and an optional
  // maxWords cap (used for safe test runs). Defaults to the global TTS config.
  const cfg = await loadAgentConfig(db, "tts");
  const plan = request.data?.plan ? sanitizeQaidaPlan(request.data.plan) : planFromConfig(cfg);
  const { total, withAudio, remaining } = await countAudio(db);
  if (remaining <= 0) {
    await audioJobRef(db).set({ status: "done", total, processed: withAudio, remaining: 0, updatedAt: new Date() }, { merge: true });
    return { status: "done", total, processed: withAudio, remaining: 0 };
  }
  // Reset the job (clear any prior error/pacing timers) and run one primer pass
  // immediately so the UI moves; the scheduled worker then drains the rest. Stamp
  // the starting coverage so a maxWords cap measures only THIS run's new clips.
  await audioJobRef(db).set({
    status: "queued", total, processed: withAudio, remaining, failed: 0,
    plan, runStartWithAudio: withAudio,
    lastVoicedAtMs: 0, providerLastVoicedMs: { gemini: 0, openai: 0 },
    error: null, lastError: "", pacing: plan.mode === "gemini" ? PACING_MSG : PACING_MSG_FAST,
    startedAt: new Date(), updatedAt: new Date(),
  }, { merge: true });
  try { await runQaidaAudioPass({ db }); } catch (e) { console.warn(`[qaida] primer pass failed: ${e?.message || e}`); }
  const after = await countAudio(db);
  return { status: "queued", total: after.total, processed: after.withAudio, remaining: after.remaining };
});

// Stop a running/queued job. The worker re-checks and finalises as cancelled.
export const stopQaidaAudio = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  await audioJobRef(db).set({ status: "cancelled", updatedAt: new Date() }, { merge: true });
  return { status: "cancelled" };
});

// Delete ALL generated audio (clear audioUrl/audioInstruction on every item) but
// keep the lessons + spell scripts, so the superadmin can regenerate audio from
// scratch without re-importing the corpus. Clears the job doc too.
export const deleteQaidaAudio = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).get();
  let cleared = 0;
  for (const doc of snap.docs) {
    const items = (doc.data().items || []).map((it) => {
      if (it.audioUrl || it.audioInstruction) cleared += 1;
      return { ...it, audioUrl: null, audioInstruction: null, audioVoice: null, audioModel: null, audioProvider: null };
    });
    await doc.ref.update({ items, updatedAt: new Date() });
  }
  await audioJobRef(db).set({ status: "done", processed: 0, remaining: 0, failed: 0, stallCount: 0, error: null, updatedAt: new Date() }, { merge: true });
  return { cleared };
});

async function isCancelled(db, ref) {
  const s = await ref.get();
  return s.exists && s.data().status === "cancelled";
}

// One worker pass: claim a DUE queued (or stale-running) job, then voice missing
// scripts across the plan's provider lane(s) — Gemini gently (free-tier reserve),
// OpenAI fast (paid). In "distribute" mode this pass's budget is split across
// providers in proportion to their RPM. Always re-queues (never pauses) so it
// auto-resumes. Exported for tests.
export async function runQaidaAudioPass({ db, batch = VOICE_BATCH }) {
  const ref = audioJobRef(db);
  // Claim atomically, but ONLY when a pass is due (plan-aware rate limiter) — or to
  // reclaim a job orphaned in "running" past its stale window. The scheduled worker
  // fires every minute and harmlessly no-ops here until the next pass is due.
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return null;
    const d = fresh.data();
    const claimedAtMs = d.claimedAt?.toMillis?.() ?? 0;
    const staleRunning = d.status === "running" && Date.now() - claimedAtMs > STALE_RUNNING_MS;
    if (!planPassDue(d, Date.now()) && !staleRunning) return null;
    tx.set(ref, { status: "running", claimedAt: new Date(), updatedAt: new Date() }, { merge: true });
    return d;
  });
  if (!claimed) return { processed: 0 };

  // Whatever happens below, never leave the job wedged in "running": on any
  // unexpected throw, re-queue it so the next pass (or the user) can resume.
  try {
    const cfg = await loadAgentConfig(db, "tts");
    const plan = claimed.plan || planFromConfig(cfg);

    // Build a lane per active provider: secret/key, effective model + voice, and
    // whether it's due + configured this pass.
    const lanes = activeProviders(plan).map((p) => {
      const { secret } = TTS_PROVIDERS[p];
      const model = effectiveTtsModel(p, planModel(plan, p));
      return {
        provider: p,
        secret,
        apiKey: process.env[secret],
        model,
        voiceName: effectiveTtsVoice(p, cfg.voiceName, model),
        due: providerDue(p, claimed, Date.now()),
      };
    });
    const usable = lanes.filter((l) => l.apiKey && l.due);
    if (!usable.length) {
      const missingKey = lanes.find((l) => l.due && !l.apiKey);
      const { total, withAudio, remaining } = await countAudio(db);
      if (missingKey) {
        await ref.set({ status: "error", total, processed: withAudio, remaining,
          error: `TTS not configured (${missingKey.secret}).`, updatedAt: new Date() }, { merge: true });
        return { processed: 0, configured: false };
      }
      // Nothing due this minute (e.g. Gemini-only between gentle passes) — re-queue.
      await ref.set({ status: "queued", total, processed: withAudio, remaining, updatedAt: new Date() }, { merge: true });
      return { processed: 0 };
    }

    // maxWords test cap: never voice more than (runStartWithAudio + maxWords) total.
    const startWith = Number(claimed.runStartWithAudio) || 0;
    const pre = await countAudio(db);
    const capLeft = plan.maxWords != null ? Math.max(0, startWith + plan.maxWords - pre.withAudio) : Infinity;
    if (capLeft <= 0) {
      await ref.set({ status: "done", total: pre.total, processed: pre.withAudio, remaining: pre.remaining,
        lastError: `Test limit reached (${plan.maxWords} words).`, updatedAt: new Date(), finishedAt: new Date() }, { merge: true });
      return { processed: 0 };
    }

    // Per-provider per-pass call budget. Gemini respects the platform reserve so it
    // can't starve families; OpenAI is paid (no daily pool) and runs a larger batch.
    const budgets = {};
    for (const l of usable) {
      if (l.provider === "gemini") {
        const reserveLeft = await platformTtsRemaining(db, l.model);
        budgets.gemini = Math.min(batch, Math.max(0, reserveLeft));
      } else {
        budgets.openai = OPENAI_PASS_BATCH;
      }
    }
    // Distribute mode: split this pass's combined budget across lanes by RPM.
    let laneBudget = budgets;
    if (usable.length > 1) {
      const weights = {};
      for (const l of usable) weights[l.provider] = limitFor(l.provider, l.model).rpm;
      const passCount = Math.min(capLeft, usable.reduce((s, l) => s + (budgets[l.provider] || 0), 0));
      const split = splitByRate(passCount, weights);
      laneBudget = {};
      for (const l of usable) laneBudget[l.provider] = Math.min(split[l.provider] || 0, budgets[l.provider] || 0);
    }

    if (await isCancelled(db, ref)) { await finalizeAudioJob(db, ref, "cancelled"); return { processed: 0 }; }

    // Scan items still missing audio (mutated in place; writing the array persists).
    const snap = await db.collection(COLLECTION).orderBy("order").get();
    const lessons = snap.docs.map((d) => ({ ref: d.ref, items: d.data().items || [] }));
    const pending = [];
    for (const lesson of lessons) {
      for (const item of lesson.items) {
        if (!item.audioUrl && item.spellScript) pending.push({ lesson, item });
        if (pending.length >= PENDING_SCAN_CAP) break;
      }
      if (pending.length >= PENDING_SCAN_CAP) break;
    }

    // Voice lane-by-lane (highest throughput first). Cached scripts apply FREE and
    // don't burn the call budget, but still count toward the maxWords cap.
    const changed = new Set();
    const stats = {};
    let voicedThisPass = 0, cursor = 0;
    for (const lane of usable) {
      const s = (stats[lane.provider] = { done: 0, apiCalls: 0, failed: 0, quotaFails: 0, sampleError: "" });
      let budget = Math.min(laneBudget[lane.provider] || 0, capLeft - voicedThisPass);
      while (budget > 0 && cursor < pending.length && voicedThisPass < capLeft) {
        const { lesson, item } = pending[cursor++];
        try {
          const { text: ttsText, instructions: ttsInstr } = qaidaTtsPayload(item, lane.provider, lane.model);
          const { url, cached } = await synthToStorage({ provider: lane.provider, text: ttsText, voiceName: lane.voiceName, model: lane.model, apiKey: lane.apiKey, instructions: ttsInstr });
          item.audioUrl = url; s.done += 1; voicedThisPass += 1; changed.add(lesson);
          if (!cached) {
            s.apiCalls += 1; budget -= 1;
            if (budget > 0) await sleep(lane.provider === "openai" ? OPENAI_PER_CALL_DELAY_MS : PER_CALL_DELAY_MS);
          }
        } catch (e) {
          s.apiCalls += 1; budget -= 1; s.failed += 1;
          if (isQuotaError(e)) s.quotaFails += 1;
          if (!s.sampleError) s.sampleError = String(e?.message || e).slice(0, 200);
        }
        if (await isCancelled(db, ref)) break;
      }
      if (await isCancelled(db, ref)) break;
    }
    for (const lesson of changed) await lesson.ref.update({ items: lesson.items, updatedAt: new Date() });

    // Record real usage + stamp each provider that actually called the API (so its
    // pacing interval starts). Cache-only passes leave timestamps untouched.
    const nowMs = Date.now();
    const providerLastVoicedMs = { ...(claimed.providerLastVoicedMs && typeof claimed.providerLastVoicedMs === "object" ? claimed.providerLastVoicedMs : {}) };
    let totalDone = 0, totalFailed = 0, lastErr = "";
    for (const lane of usable) {
      const s = stats[lane.provider]; if (!s) continue;
      totalDone += s.done; totalFailed += s.failed;
      if (s.sampleError && !lastErr) lastErr = `${lane.provider}: ${s.sampleError}`;
      if (s.apiCalls) {
        providerLastVoicedMs[lane.provider] = nowMs;
        await recordTtsUsage(db, { model: lane.model, requests: s.apiCalls, ok: s.done, quotaErrors: s.quotaFails, otherErrors: s.failed - s.quotaFails });
      }
    }
    console.log(`[qaida] pass mode=${plan.mode}: voiced ${totalDone}${lastErr ? ` — e.g. ${lastErr}` : ""}`);

    const { total, withAudio, remaining } = await countAudio(db);
    if (await isCancelled(db, ref)) {
      await ref.set({ status: "cancelled", total, processed: withAudio, remaining, updatedAt: new Date(), finishedAt: new Date() }, { merge: true });
      return { processed: totalDone };
    }
    const capReached = plan.maxWords != null && withAudio - startWith >= plan.maxWords;
    if (remaining <= 0 || capReached) {
      await ref.set({ status: "done", total, processed: withAudio, remaining, failed: 0,
        ...(capReached && remaining > 0 ? { lastError: `Test limit reached (${plan.maxWords} words).` } : {}),
        updatedAt: new Date(), finishedAt: new Date() }, { merge: true });
      return { processed: totalDone };
    }

    await ref.set({
      status: "queued", total, processed: withAudio, remaining, failed: totalFailed,
      providerLastVoicedMs,
      lastError: lastErr || "", pacing: plan.mode === "gemini" ? PACING_MSG : PACING_MSG_FAST, updatedAt: new Date(),
    }, { merge: true });
    return { processed: totalDone };
  } catch (e) {
    // Self-heal: never leave it "running". Re-queue with the error noted.
    await ref.set({ status: "queued", lastError: String(e?.message || e).slice(0, 200), updatedAt: new Date() }, { merge: true });
    console.error(`[qaida] audio pass crashed, re-queued: ${e?.message || e}`);
    return { processed: 0, crashed: true };
  }
}

async function finalizeAudioJob(db, ref, status) {
  const { total, withAudio, remaining } = await countAudio(db);
  await ref.set({ status, total, processed: withAudio, remaining, updatedAt: new Date(), finishedAt: new Date() }, { merge: true });
}

// Scheduled drain — same cadence/shape as contentBackfillWorker.
export const qaidaAudioWorker = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 540, secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"], maxInstances: 1 },
  async () => { await runQaidaAudioPass({ db: getFirestore() }); }
);

// Regenerate ONE item's audio, optionally biased by a superadmin instruction
// (e.g. "say the letter names more slowly"). The instruction is prepended as a
// TTS style cue and never spoken; it also changes the cache key so the new take
// is stored separately.
//
// Two-step, preview-then-save: with `preview: true` (the default the UI uses on
// the Regen button) we synthesize and return the clip URL WITHOUT touching the
// corpus — the superadmin listens first. Calling again with `preview: false` and
// the same instruction persists it; that second synth is a free shared-cache hit,
// and re-deriving the URL server-side means the client can't save an arbitrary one.
export const regenerateQaidaWord = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"], timeoutSeconds: 120 },
  async (request) => {
    requireSuperAdmin(request);
    const db = getFirestore();

    const lessonId = String(request.data?.lessonId || "").trim();
    const glyph = String(request.data?.glyph || "");
    const instruction = String(request.data?.instruction || "").trim().slice(0, 200);
    const preview = Boolean(request.data?.preview);
    // Optional per-generation overrides — let the superadmin try a different TTS
    // provider / model / voice for THIS take only, without changing global config.
    const providerOverride = String(request.data?.provider || "").trim();
    const modelOverride = String(request.data?.model || "").trim().slice(0, 80);
    const voiceOverride = String(request.data?.voiceName || "").trim().slice(0, 60);
    if (!lessonId || !glyph) throw new HttpsError("invalid-argument", "lessonId and glyph are required.");

    const ref = db.collection(COLLECTION).doc(lessonId);
    const doc = await ref.get();
    if (!doc.exists) throw new HttpsError("not-found", "Lesson not found.");
    const items = doc.data().items || [];
    const item = items.find((i) => i.glyph === glyph);
    if (!item) throw new HttpsError("not-found", "Glyph not found in lesson.");

    const cfg = await loadAgentConfig(db, "tts");
    const provider = resolveTtsProvider(providerOverride || cfg.provider);
    const { secret } = TTS_PROVIDERS[provider];
    const apiKey = process.env[secret];
    if (!apiKey) return { configured: false };
    // effectiveTts* coerce a stale/mismatched override (e.g. a Gemini voice picked
    // while switching to OpenAI) onto a valid value for the chosen provider.
    const model = effectiveTtsModel(provider, modelOverride || cfg.model);
    const voiceName = effectiveTtsVoice(provider, voiceOverride || cfg.voiceName, model);
    // Pure-Arabic spoken text + an explicit pure-Arabic directive, steered per
    // (provider, model) (see qaidaTtsPayload). Any per-take instruction folds into
    // the directive rather than being spoken aloud.
    const { text, instructions: ttsInstructions } = qaidaTtsPayload(item, provider, model, instruction);

    try {
      const { url } = await synthToStorage({ provider, text, voiceName, model, apiKey, instructions: ttsInstructions });
      // Preview only: hand back the clip to audition; leave the corpus untouched.
      if (preview) return { configured: true, preview: true, audioUrl: url, voiceName, model, provider };
      // Save: persist the approved take onto the item (recording provider/voice/model used).
      item.audioUrl = url;
      item.audioInstruction = instruction || null;
      item.audioVoice = voiceName;
      item.audioModel = model;
      item.audioProvider = provider;
      await ref.update({ items, updatedAt: new Date() });
      return { configured: true, audioUrl: item.audioUrl, voiceName, model, provider };
    } catch (e) {
      throw new HttpsError("internal", e?.message || "Audio regeneration failed.");
    }
  }
);
