// Superadmin USAGE dashboard — a simple, plain-language view of AI usage, limits,
// and health, aimed at a non-technical superadmin. Distinct from the per-family
// "Costs" tab (USD detail): this answers "is everything healthy, am I hitting a
// limit, what's it costing?" at a glance.
//
// Data sources (all already in the app — no Google quota API needed):
//   • platform/usage/daily/{day}     — lightweight request/error counters the TTS
//                                       worker writes (recordTtsUsage), so we can
//                                       show "TTS today: 113 / 100 limit".
//   • platform/qaidaAudioJob         — live Qaida audio job state (paused/voicing).
//   • platformCostRollups/{month}    — spend + calls + by-model/by-kind.
//   • costEvents (collection group)  — recent raw activity (best-effort log).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { platformCostRollups } from "../lib/paths.js";

// Known per-day request limits for THIS key's tier (AI Studio → Rate Limit, Tier 1).
// Used purely to draw "X / limit" gauges + alerts; not enforced here.
export const KNOWN_LIMITS = {
  "gemini-2.5-flash-preview-tts": { rpd: 100, rpm: 10 },
  "gemini-2.5-pro-preview-tts": { rpd: 50, rpm: 10 },
};
const DEFAULT_TTS_RPD = 100;

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
}

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
function lastNDayKeys(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(now.getTime() - i * 86400000)));
  return out;
}

function dailyUsageRef(db, day) {
  return db.collection("platform").doc("usage").collection("daily").doc(day);
}

// Best-effort counter the TTS worker calls once per pass. Buckets by outcome so
// the dashboard can show requests vs errors vs the daily limit. Never throws.
export async function recordTtsUsage(db, { model = "unknown", requests = 0, ok = 0, quotaErrors = 0, otherErrors = 0 } = {}) {
  try {
    if (!db || !requests) return;
    await dailyUsageRef(db, dayKey()).set({
      date: dayKey(),
      tts: {
        requests: FieldValue.increment(requests),
        ok: FieldValue.increment(ok),
        quotaErrors: FieldValue.increment(quotaErrors),
        otherErrors: FieldValue.increment(otherErrors),
      },
      [`byModel.${model}`]: {
        requests: FieldValue.increment(requests),
        ok: FieldValue.increment(ok),
        quotaErrors: FieldValue.increment(quotaErrors),
      },
      updatedAt: new Date(),
    }, { merge: true });
  } catch (e) { console.warn(`[usage] recordTtsUsage failed: ${e?.message || e}`); }
}

// ─── Pure alert builder (unit-tested) ──────────────────────────────────────────
// Turns raw numbers into a few plain-language cards a non-technical admin gets.
export function buildUsageAlerts({ todayTts = {}, ttsLimit = DEFAULT_TTS_RPD, qaida = null, monthCostUsd = 0, monthCalls = 0 }) {
  const alerts = [];
  const req = Number(todayTts.requests) || 0;
  const quota = Number(todayTts.quotaErrors) || 0;

  // 1) Text-to-speech daily limit — the thing that bit us.
  if (req >= ttsLimit || quota > 0) {
    alerts.push({
      level: "danger", icon: "⛔",
      title: "Text-to-speech daily limit reached",
      detail: `You've used ${req} of ~${ttsLimit} allowed speech requests today, so new audio is paused. It resets automatically (around midnight US Pacific). To do more today, raise the TTS tier in Google AI Studio.`,
    });
  } else if (req >= Math.floor(ttsLimit * 0.8)) {
    alerts.push({
      level: "warn", icon: "⚠️",
      title: "Close to the text-to-speech daily limit",
      detail: `${req} of ~${ttsLimit} speech requests used today. Audio will pause for the day once you reach the limit.`,
    });
  } else {
    alerts.push({
      level: "ok", icon: "✅",
      title: "Text-to-speech usage is healthy",
      detail: `${req} of ~${ttsLimit} speech requests used today.`,
    });
  }

  // 2) Qaida audio job — what's it doing right now.
  if (qaida) {
    const p = Number(qaida.processed) || 0, t = Number(qaida.total) || 0;
    if (qaida.status === "paused") {
      alerts.push({ level: "warn", icon: "⏸", title: "Qaida audio is paused", detail: `${p} of ${t} words voiced. It paused because the speech limit was reached — click Restart on the Qaida tab after the limit resets.` });
    } else if (["queued", "running"].includes(qaida.status)) {
      alerts.push({ level: "ok", icon: "🔊", title: "Qaida audio is generating", detail: `${p} of ${t} words voiced and counting.` });
    } else if (qaida.status === "done" && t > 0) {
      alerts.push({ level: "ok", icon: "✅", title: "Qaida audio is complete", detail: `All ${t} words have audio.` });
    } else if (qaida.status === "error") {
      alerts.push({ level: "danger", icon: "❌", title: "Qaida audio stopped on an error", detail: qaida.error || "Open the Qaida tab and click Restart audio." });
    }
  }

  // 3) Spend this month — informational.
  alerts.push({
    level: "ok", icon: "💰",
    title: "AI spend this month",
    detail: `About $${(Number(monthCostUsd) || 0).toFixed(2)} across ${monthCalls} AI calls so far this month.`,
  });

  return alerts;
}

const plainRollup = (d = {}) => ({
  costUsd: Number(d.costUsd) || 0,
  calls: Number(d.calls) || 0,
  byModel: d.byModel || {},
  byKind: d.byKind || {},
});

// ─── The dashboard callable ─────────────────────────────────────────────────────
export const getUsageDashboard = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const now = new Date();
  const days = lastNDayKeys(14, now);
  const month = now.toISOString().slice(0, 7);

  // Daily TTS counters (14 days) + qaida job + this month's cost rollup, in parallel.
  const [daySnaps, qaidaSnap, monthSnap] = await Promise.all([
    Promise.all(days.map((d) => dailyUsageRef(db, d).get())),
    db.collection("platform").doc("qaidaAudioJob").get(),
    platformCostRollups(db).doc(month).get(),
  ]);

  const trend = daySnaps.map((s, i) => {
    const tts = (s.exists ? s.data().tts : null) || {};
    return {
      date: days[i],
      requests: Number(tts.requests) || 0,
      ok: Number(tts.ok) || 0,
      errors: (Number(tts.quotaErrors) || 0) + (Number(tts.otherErrors) || 0),
      quotaErrors: Number(tts.quotaErrors) || 0,
    };
  });
  const todayTts = (daySnaps[daySnaps.length - 1].exists ? daySnaps[daySnaps.length - 1].data().tts : {}) || {};

  const qaida = qaidaSnap.exists ? {
    status: qaidaSnap.data().status || null,
    processed: Number(qaidaSnap.data().processed) || 0,
    total: Number(qaidaSnap.data().total) || 0,
    remaining: Number(qaidaSnap.data().remaining) || 0,
    error: qaidaSnap.data().error || qaidaSnap.data().lastError || null,
  } : null;

  const monthRollup = monthSnap.exists ? plainRollup(monthSnap.data()) : { costUsd: 0, calls: 0, byModel: {}, byKind: {} };
  const ttsLimit = KNOWN_LIMITS["gemini-2.5-flash-preview-tts"].rpd;

  // Recent activity log (best-effort; ignore if the collection-group index isn't ready).
  let recent = [];
  try {
    const evSnap = await db.collectionGroup("costEvents").orderBy("ts", "desc").limit(25).get();
    recent = evSnap.docs.map((d) => {
      const e = d.data();
      return {
        ts: e.ts?.toMillis?.() ?? null,
        kind: e.kind, model: e.model, agentKey: e.agentKey,
        costUsd: Number(e.costUsd) || 0, cached: Boolean(e.cached),
      };
    });
  } catch (e) { console.warn(`[usage] recent log unavailable: ${e?.message || e}`); }

  const alerts = buildUsageAlerts({
    todayTts, ttsLimit, qaida,
    monthCostUsd: monthRollup.costUsd, monthCalls: monthRollup.calls,
  });

  return {
    generatedAt: now.toISOString(),
    alerts,
    today: { date: dayKey(now), tts: { requests: Number(todayTts.requests) || 0, ok: Number(todayTts.ok) || 0, quotaErrors: Number(todayTts.quotaErrors) || 0, otherErrors: Number(todayTts.otherErrors) || 0 }, ttsLimit },
    trend,
    qaida,
    month: { period: month, ...monthRollup },
    limits: KNOWN_LIMITS,
    recent,
  };
});
