// Single source of truth for all agents: one regenerated "knowledge brief" per
// family that captures the EXACT curriculum + syllabus + planner data PLUS an AI
// pedagogical narrative (how activities link, how complexity grows across dates,
// what repeats and why, what's next per activity type). Injected into every
// agent's grounding so they share one enriched understanding.
//
// Regeneration is checkpoint-driven (after a syllabus build / auto-schedule /
// curriculum finalize, or a manual rebuild) — NOT on every write — to avoid an
// LLM call per keystroke. Cheap Firestore triggers only flag the brief `stale`.
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { familyPaths } from "../lib/paths.js";
import { resolveCaller } from "../lib/caller.js";
import { resolveLlm } from "./agentConfig.js";

function briefRef(db, familyId) {
  return db.collection("families").doc(familyId).collection("meta").doc("knowledge_brief");
}

// Assemble the exact structured snapshot of curriculum + syllabus + schedule.
export async function buildBriefData(db, familyId) {
  const p = familyPaths(db, familyId);
  const [actSnap, daysSnap] = await Promise.all([
    p.activities().limit(400).get(),
    p.calendarDays().get(),
  ]);

  // Active curriculum (fall back to the most recent one) + its subjects.
  let currDoc = null;
  const activeSnap = await p.curriculum().where("status", "==", "active").limit(1).get().catch(() => null);
  if (activeSnap && !activeSnap.empty) currDoc = activeSnap.docs[0];
  if (!currDoc) { const any = await p.curriculum().limit(1).get(); currDoc = any.docs[0] || null; }

  let curriculum = null;
  let subjects = [];
  if (currDoc) {
    const c = currDoc.data();
    curriculum = { id: currDoc.id, title: c.title || "", objectives: c.objectives || "" };
    const subjSnap = await currDoc.ref.collection("subjects").get();
    subjects = subjSnap.docs.map((d) => ({
      id: d.id, name: d.data().name || d.id,
      macroGoals: d.data().macroGoals || [],
      contentOutline: d.data().contentOutline || "",
    }));
  }

  const activities = actSnap.docs.map((d) => {
    const a = d.data();
    return { id: d.id, title: a.title, type: a.type, subject: a.subject || "", subjectId: a.subjectId || "", complexityRank: a.complexityRank || 1, durationMinutes: a.durationMinutes || 0 };
  });

  const schedule = [];
  for (const day of daysSnap.docs) {
    const blocks = await day.ref.collection("blocks").get();
    if (blocks.empty) continue;
    schedule.push({
      date: day.id,
      blocks: blocks.docs.map((b) => { const x = b.data(); return { activityId: x.activityId, title: x.activityTitle, type: x.type, time: x.scheduledTime, rank: x.complexityRank }; }),
    });
  }
  schedule.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return { curriculum, subjects, activities, schedule };
}

const BRIEF_SYSTEM = [
  "You are a homeschooling pedagogy expert. Given a family's curriculum, the generated",
  "syllabus activities (complexity rank 1=intro → 5=mastery), and the planner schedule,",
  "write a concise BRIEF (200-350 words) that explains the LEARNING JOURNEY:",
  "- how activities connect and build on each other,",
  "- how complexity progresses over time / across the scheduled dates,",
  "- which activities repeat and why (e.g. memorisation, spaced practice),",
  "- what comes next within each activity type.",
  "Be concrete and reference real titles. This brief grounds other AI agents and helps",
  "parents understand the path — write it so it is useful to both. Prose only, no preamble.",
].join("\n");

// Regenerate the brief (data + AI narrative) and persist it. Best-effort on the
// narrative — data is always refreshed even if the LLM is unavailable.
export async function regenerateBrief({ db, familyId, llm, genConfig }) {
  const data = await buildBriefData(db, familyId);
  let narrative = "";
  const hasContent = data.activities.length || data.subjects.length;
  if (llm && hasContent) {
    const user = "DATA (JSON):\n" + JSON.stringify(data).slice(0, 14000) + "\n\nWrite the brief now.";
    try {
      const res = await llm.generate({ system: BRIEF_SYSTEM, contents: [{ role: "user", parts: [{ text: user }] }], config: genConfig });
      narrative = (res.text || "").trim();
    } catch (e) { console.warn(`[brief] narrative generation failed for ${familyId}: ${e?.message || e}`); }
  }
  await briefRef(db, familyId).set({ data, narrative, generatedAt: new Date(), stale: false }, { merge: true });
  return { narrative, hasNarrative: Boolean(narrative) };
}

// Convenience used by the syllabus / scheduler / curriculum checkpoints. Resolves
// the 'brief' LLM itself; silently no-ops if unconfigured so it never blocks the
// primary operation.
export async function regenerateBriefSafe(db, familyId) {
  try {
    const { llm, genConfig } = await resolveLlm(db, "brief", process.env.GEMINI_API_KEY);
    await regenerateBrief({ db, familyId, llm, genConfig });
  } catch (e) { console.warn(`[brief] regenerateBriefSafe(${familyId}) failed: ${e?.message || e}`); }
}

// Compact brief text for injection into agent grounding (narrative + a 1-line
// schedule range). Empty string when no brief exists yet.
export async function loadBriefForGrounding(db, familyId) {
  try {
    const snap = await briefRef(db, familyId).get();
    if (!snap.exists) return "";
    const b = snap.data();
    if (!b.narrative) return "";
    const dates = (b.data?.schedule || []).map((s) => s.date);
    const range = dates.length ? ` (scheduled ${dates[0]} → ${dates[dates.length - 1]})` : "";
    const stale = b.stale ? " [note: may be slightly out of date]" : "";
    return `CURRICULUM & SYLLABUS BRIEF — single source of truth${range}${stale}:\n${b.narrative}`;
  } catch (e) {
    console.warn(`[brief] loadBriefForGrounding(${familyId}) failed: ${e?.message || e}`);
    return "";
  }
}

// ── Triggers: flag the brief stale on curriculum / activity / schedule writes ──
export function buildBriefTriggers() {
  const paths = {
    brief_activities: "families/{familyId}/activities/{docId}",
    brief_curriculum: "families/{familyId}/curriculum/{docId}",
    brief_blocks: "families/{familyId}/calendarDays/{dateKey}/blocks/{blockId}",
  };
  const triggers = {};
  for (const [name, path] of Object.entries(paths)) {
    triggers[name] = onDocumentWritten(path, async (event) => {
      const { familyId } = event.params;
      try {
        await briefRef(getFirestore(), familyId).set({ stale: true, staleAt: new Date() }, { merge: true });
      } catch (e) { console.warn(`[brief] stale-flag write failed for ${familyId}: ${e?.message || e}`); }
    });
  }
  return triggers;
}

// ── Manual rebuild callable ───────────────────────────────────────────────────
export const rebuildKnowledgeBrief = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120 }, async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const { llm, genConfig } = await resolveLlm(db, "brief", process.env.GEMINI_API_KEY);
  if (!llm) return { configured: false };
  const { hasNarrative } = await regenerateBrief({ db, familyId, llm, genConfig });
  return { configured: true, hasNarrative };
});

// ── Per-activity "where this fits" journey for parents ────────────────────────
export async function runActivityJourney({ db, familyId, activityId, llm, genConfig }) {
  const p = familyPaths(db, familyId);
  const actSnap = await p.activities().doc(activityId).get();
  if (!actSnap.exists) throw new HttpsError("not-found", "Activity not found.");
  const activity = { id: actSnap.id, ...actSnap.data() };

  // Prefer the cached brief data; rebuild the data snapshot if absent.
  let data;
  const bSnap = await briefRef(db, familyId).get();
  data = bSnap.exists ? bSnap.data().data : null;
  if (!data) data = await buildBriefData(db, familyId);

  if (!llm) return { configured: false, text: "" };
  const system = [
    "You explain to a homeschooling PARENT where a single activity sits in their child's plan,",
    "so they can guide and mentor well even without seeing the full planner.",
    "In 2-4 short sentences cover: what role today's activity plays, whether/why it repeats,",
    "what came before it, and what comes next in the SAME activity type. Warm, concrete, no preamble.",
  ].join("\n");
  const user = [
    `TODAY'S ACTIVITY: ${activity.title} (type ${activity.type}, complexity ${activity.complexityRank}/5).`,
    "",
    "PLAN DATA (JSON):",
    JSON.stringify(data).slice(0, 12000),
  ].join("\n");
  try {
    const res = await llm.generate({ system, contents: [{ role: "user", parts: [{ text: user }] }], config: genConfig });
    return { configured: true, text: (res.text || "").trim() };
  } catch (e) {
    throw new HttpsError("internal", e?.message || "Could not build the activity journey.");
  }
}

export const getActivityJourney = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60 }, async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const activityId = String(request.data?.activityId || "").trim();
  if (!activityId) throw new HttpsError("invalid-argument", "activityId is required.");
  const { llm, genConfig } = await resolveLlm(db, "brief", process.env.GEMINI_API_KEY);
  if (!llm) return { configured: false, text: "" };
  return runActivityJourney({ db, familyId, activityId, llm, genConfig });
});
