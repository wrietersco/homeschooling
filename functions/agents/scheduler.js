// Auto-scheduler — the parent clicks "Schedule via agent" on the planner and an
// agent lays the family's syllabus activities onto the chosen week's calendar,
// respecting guardian availability, child profiles, the guiding light, activity
// duration, and complexity progression. Blocks are written with status
// "planned" so the parent can still drag / edit / remove them afterwards.
//
// Architecture mirrors the other agents: grounded system prompt (guiding light +
// guardians WITH availability + children) + one purpose-built schedule_block
// tool, run through the shared ReAct loop. Progress is recorded to
// agentRuns/{runId} for the audit trail.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";
import { buildGroundedSystemPrompt } from "./grounding.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";
import { regenerateBriefSafe } from "./knowledgeBrief.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Shift a YYYY-MM-DD key by whole days (UTC), returning a YYYY-MM-DD key.
function shiftDateKey(key, deltaDays) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Read the calendar blocks placed in a window around the target week (recent
// past + the week itself + a little ahead) so the scheduler knows what has
// already been planned. Day docs only exist where something was scheduled, so
// this stays cheap. Best-effort: returns { days: [] } on any read failure.
export async function loadScheduleHistory({ db, familyId, weekDateKeys, weeksBefore = 6, weeksAfter = 3 }) {
  const sorted = [...(weekDateKeys || [])].filter(Boolean).sort();
  if (!sorted.length) return { days: [] };
  const startKey = shiftDateKey(sorted[0], -Math.abs(weeksBefore) * 7);
  const endKey = shiftDateKey(sorted[sorted.length - 1], Math.abs(weeksAfter) * 7);
  const p = familyPaths(db, familyId);
  // Derive FieldPath from the injected db's own package, not a static import.
  // A statically-imported FieldPath (functions' firebase-admin copy) is a
  // different class than a test-injected root-level admin db, and Firestore
  // rejects the cross-package documentId() sentinel — silently failing this
  // best-effort read so the scheduler ran with no history. See db.constructor.
  const docId = db.constructor.FieldPath.documentId();
  try {
    const daySnap = await p.calendarDays()
      .where(docId, ">=", startKey)
      .where(docId, "<=", endKey)
      .get();
    const days = [];
    for (const dayDoc of daySnap.docs) {
      const blocksSnap = await dayDoc.ref.collection("blocks").get();
      if (blocksSnap.empty) continue;
      days.push({
        date: dayDoc.id,
        blocks: blocksSnap.docs.map((b) => {
          const x = b.data();
          return {
            activityId: x.activityId || "",
            title: x.activityTitle || "",
            type: x.type || "",
            subject: x.subject || "",
            time: x.scheduledTime || "",
            rank: x.complexityRank || 0,
          };
        }),
      });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return { days };
  } catch (e) {
    console.warn(`[scheduler] loadScheduleHistory(${familyId}) failed: ${e?.message || e}`);
    return { days: [] };
  }
}

// Summarise loaded schedule days into: how many times each activity is already
// placed (so the pool can flag repeats), plus human-readable lines split into the
// target week vs the surrounding weeks. Pure — exported for unit tests.
export function summarizeScheduleHistory(days, weekDateKeys) {
  const inWeek = new Set(weekDateKeys || []);
  const counts = new Map();
  const pastLines = [];
  const weekLines = [];
  for (const d of days || []) {
    const blocks = d.blocks || [];
    for (const b of blocks) {
      if (b.activityId) counts.set(b.activityId, (counts.get(b.activityId) || 0) + 1);
    }
    const dow = DAY_NAMES[new Date(d.date + "T00:00:00Z").getUTCDay()] || "";
    const summary = blocks
      .map((b) => `${b.time || "—"} ${b.title || b.activityId}${b.rank ? ` (r${b.rank})` : ""}`)
      .join("; ");
    const line = `- ${d.date}${dow ? ` (${dow})` : ""}: ${summary}`;
    (inWeek.has(d.date) ? weekLines : pastLines).push(line);
  }
  return { counts, pastLines, weekLines };
}

const SCHEDULER_BASE_PROMPT = [
  "You are the family's planning assistant. Lay the family's existing activities onto the",
  "calendar for the requested week, creating a realistic, balanced schedule.",
  "",
  "SCHEDULING PRINCIPLES:",
  "- Respect each guardian's stated availability — only place activities in times a guardian",
  "  who can facilitate them is available. If availability is unknown, prefer mornings on weekdays.",
  "- Spread work sensibly across the days; don't cram everything into one day. Aim for a few",
  "  activities per active day, ordered easiest-first within a day.",
  "- Progress complexity over the week (introductory earlier, harder later) where it makes sense.",
  "- Keep each child's daily load age-appropriate; co-op activities can serve multiple children at once.",
  "- Honour activity durations when spacing start times (avoid overlapping the same guardian).",
  "- Everything must serve the family's guiding light.",
  "",
  "CONTINUITY WITH WHAT'S ALREADY PLANNED:",
  "- The 'ALREADY ON THE CALENDAR' section below shows what recent/upcoming weeks already",
  "  cover. ADVANCE the progression from there — pick the next activities up the complexity",
  "  ranks, don't restart from the basics.",
  "- Do NOT re-place an activity that was already scheduled in a recent week (flagged",
  "  '⚠ already scheduled N×' in the pool) unless it is deliberate spaced practice such as",
  "  Qur'an memorisation or revision.",
  "- Do NOT duplicate a block that already exists in THIS week.",
  "",
  "Call schedule_block once per placement. Use ONLY activityIds and dateKeys provided below.",
  "When you have laid out a sensible week, stop and give a one-sentence summary.",
].join("\n");

const SCHEDULE_BLOCK_DECLARATION = {
  name: "schedule_block",
  description:
    "Place one activity on the calendar at a specific day + time. Call once per scheduled activity.",
  parameters: {
    type: "object",
    properties: {
      activityId: { type: "string", description: "An activity id from the provided list." },
      dateKey: { type: "string", description: "Target day as YYYY-MM-DD — must be one of the week's days." },
      scheduledTime: { type: "string", description: "Start time as 24h HH:MM, e.g. '09:00'." },
      guardianId: { type: "string", description: "The guardian id who will facilitate (optional)." },
      notes: { type: "string", description: "Optional short note for the block." },
    },
    required: ["activityId", "dateKey", "scheduledTime"],
  },
};

// Core (exported for tests): place blocks for one week. `weekDateKeys` is an
// ordered array of 7 YYYY-MM-DD strings.
export async function runAutoSchedule({ db, familyId, uid, weekDateKeys, llm, genConfig }) {
  const p = familyPaths(db, familyId);

  // Load the activity pool (the syllabus).
  const actSnap = await p.activities().limit(300).get();
  const activitiesById = {};
  for (const d of actSnap.docs) activitiesById[d.id] = d.data();
  if (!actSnap.size) {
    throw new HttpsError("failed-precondition", "There are no activities to schedule — generate a syllabus first.");
  }

  // What's already on the calendar around this week, so the agent advances the
  // progression rather than re-placing past activities or double-booking the week.
  const { days: scheduleDays } = await loadScheduleHistory({ db, familyId, weekDateKeys });
  const { counts: placedCounts, pastLines, weekLines } = summarizeScheduleHistory(scheduleDays, weekDateKeys);

  const activityLines = actSnap.docs.map((d) => {
    const a = d.data();
    const placed = placedCounts.get(d.id) || 0;
    return (
      `- ${d.id} · "${a.title}" · ${a.type} · ${a.subject || ""} · rank ${a.complexityRank || 1} · ${a.durationMinutes || 30}min` +
      `${a.coopMode ? " · co-op" : ""}${(a.targetChildren || []).length ? ` · for ${(a.targetChildren).join(",")}` : ""}` +
      `${placed ? ` · ⚠ already scheduled ${placed}×` : ""}`
    );
  });

  const system = await buildGroundedSystemPrompt(db, familyId, SCHEDULER_BASE_PROMPT, "scheduler");

  // Audit / progress doc.
  const runRef = p.agentRuns().doc();
  await runRef.set({ type: "scheduler", uid, status: "running", weekDateKeys, scheduled: 0, createdAt: new Date() });

  let scheduled = 0;
  const tools = {
    async schedule_block({ activityId, dateKey, scheduledTime, guardianId, notes }) {
      const a = activitiesById[activityId];
      if (!a) return { error: `unknown activityId "${activityId}"` };
      if (!weekDateKeys.includes(dateKey)) return { error: `dateKey "${dateKey}" is outside the target week` };

      // The calendarDays parent doc must exist explicitly for collection queries
      // to return the day (implicit parents don't appear in Firestore queries).
      const dayRef = p.calendarDays().doc(dateKey);
      await dayRef.set({ updatedAt: new Date() }, { merge: true });

      const ref = await dayRef.collection("blocks").add({
        activityId,
        activityTitle: a.title || "Activity",
        subject: a.subject || "",
        subjectId: a.subjectId || "",
        type: a.type || "teaching",
        complexityRank: a.complexityRank || 1,
        coopMode: Boolean(a.coopMode),
        targetChildren: a.targetChildren || [],
        durationMinutes: a.durationMinutes || 30,
        scheduledTime: /^\d{1,2}:\d{2}$/.test(scheduledTime || "") ? scheduledTime : "09:00",
        guardianId: guardianId || null,
        notes: notes || "",
        status: "planned",
        scheduledBy: "agent",
        createdBy: uid,
        createdAt: new Date(),
      });
      scheduled++;
      return { scheduled: true, id: ref.id };
    },
  };

  const weekLine = weekDateKeys
    .map((k) => `${k} (${DAY_NAMES[new Date(k + "T00:00:00Z").getUTCDay()]})`)
    .join(", ");

  const historyBlock = (pastLines.length || weekLines.length) ? [
    "",
    "ALREADY ON THE CALENDAR — use this for continuity:",
    pastLines.length ? "Recent / upcoming weeks (build on these — advance the progression, don't repeat them):" : "",
    ...pastLines,
    weekLines.length ? "THIS week already has these blocks (do NOT duplicate them):" : "",
    ...weekLines,
  ].filter(Boolean) : [];

  const userMessage = [
    `Schedule activities for the week: ${weekLine}.`,
    "",
    "ACTIVITIES AVAILABLE (use these activityIds):",
    ...activityLines,
    ...historyBlock,
    "",
    "Place a balanced selection across the week now by calling schedule_block for each one.",
  ].join("\n");

  const result = await runAgent({
    llm,
    system,
    toolDeclarations: [SCHEDULE_BLOCK_DECLARATION],
    tools,
    userMessage,
    maxSteps: 60,
    generationConfig: genConfig,
  });

  await runRef.set(
    { status: "done", scheduled, answer: result.text, finishedAt: new Date() },
    { merge: true }
  );

  // The schedule changed — refresh the brief so agents/parents see the new plan.
  await regenerateBriefSafe(db, familyId);

  return { runId: runRef.id, scheduled, text: result.text };
}

export const autoSchedule = onCall({ secrets: ["GEMINI_API_KEY"], timeoutSeconds: 300 }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can auto-schedule.");
  }
  await enforceDailyLimit(db, familyId, "scheduler"); // audit #12
  const weekDateKeys = Array.isArray(request.data?.weekDateKeys)
    ? request.data.weekDateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).slice(0, 7)
    : [];
  if (weekDateKeys.length !== 7) {
    throw new HttpsError("invalid-argument", "weekDateKeys must be the 7 YYYY-MM-DD days of the week.");
  }

  const { llm, genConfig } = await resolveLlm(db, "scheduler", process.env.GEMINI_API_KEY, { familyId, uid, source: "autoSchedule" });
  if (!llm) {
    return { configured: false, text: "The scheduler isn't configured yet — set the GEMINI_API_KEY secret to enable it." };
  }

  const { runId, scheduled, text } = await runAutoSchedule({ db, familyId, uid, weekDateKeys, llm, genConfig });
  return { configured: true, runId, scheduled, text };
});
