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
  const activityLines = [];
  for (const d of actSnap.docs) {
    const a = d.data();
    activitiesById[d.id] = a;
    activityLines.push(
      `- ${d.id} · "${a.title}" · ${a.type} · ${a.subject || ""} · rank ${a.complexityRank || 1} · ${a.durationMinutes || 30}min` +
      `${a.coopMode ? " · co-op" : ""}${(a.targetChildren || []).length ? ` · for ${(a.targetChildren).join(",")}` : ""}`
    );
  }
  if (!activityLines.length) {
    throw new HttpsError("failed-precondition", "There are no activities to schedule — generate a syllabus first.");
  }

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

  const userMessage = [
    `Schedule activities for the week: ${weekLine}.`,
    "",
    "ACTIVITIES AVAILABLE (use these activityIds):",
    ...activityLines,
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

  const { llm, genConfig } = await resolveLlm(db, "scheduler", process.env.GEMINI_API_KEY);
  if (!llm) {
    return { configured: false, text: "The scheduler isn't configured yet — set the GEMINI_API_KEY secret to enable it." };
  }

  const { runId, scheduled, text } = await runAutoSchedule({ db, familyId, uid, weekDateKeys, llm, genConfig });
  return { configured: true, runId, scheduled, text };
});
