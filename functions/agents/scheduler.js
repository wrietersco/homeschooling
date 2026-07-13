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
import { resolveLlm, secretNameForProvider } from "./agentConfig.js";
import { regenerateBriefSafe } from "./knowledgeBrief.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Availability is stored under these weekday keys; index matches JS Date.getUTCDay().
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Shift a YYYY-MM-DD key by whole days (UTC), returning a YYYY-MM-DD key.
function shiftDateKey(key, deltaDays) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// "HH:MM" (24h) → minutes since midnight, or null if unparseable. Pure/exported.
export function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Minutes since midnight → "HH:MM" (24h). Pure.
function minutesToTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Normalise one guardian's stored availability ({ mon: [{start,end}], ... } in 24h
// "HH:MM") into { mon: [{s,e}], ... } in minutes, dropping malformed/zero-length
// spans. Returns null when the guardian has NO valid availability at all — that
// means "unconstrained / unknown", NOT "never available". Pure/exported.
export function normalizeGuardianAvailability(availability) {
  if (!availability || typeof availability !== "object") return null;
  const out = {};
  let any = false;
  for (const day of DOW_KEYS) {
    const ranges = Array.isArray(availability[day]) ? availability[day] : [];
    const spans = [];
    for (const r of ranges) {
      const s = timeToMinutes(r?.start), e = timeToMinutes(r?.end);
      if (s != null && e != null && e > s) { spans.push({ s, e }); any = true; }
    }
    out[day] = spans;
  }
  return any ? out : null;
}

// Resolve a guardian reference (the agent passes EITHER a document id OR a name —
// the prompt only ever shows it names) to the canonical guardian id. Matches id
// first, then name (case-insensitive, trimmed). Returns null when `raw` is empty
// OR matches nothing — callers treat that as "guardian unspecified", NOT as a hard
// rejection. This was the OpenAI scheduler bug: the model passed guardianId:"Rabiya"
// (the name), the old exact-id filter matched no one, and every placement was
// rejected as "unavailable" even at a perfectly valid time. Pure/exported.
export function resolveGuardianId(guardians, raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  const byId = (guardians || []).find((g) => String(g.id || "").toLowerCase() === key);
  if (byId) return byId.id;
  const byName = (guardians || []).find((g) => String(g.name || "").toLowerCase() === key);
  return byName ? byName.id : null;
}

// Decide whether a block at (dateKey, scheduledTime) can actually be facilitated,
// given the family's guardians. A guardian "covers" a slot if they are flexible
// (no availability set) OR have a window for that weekday containing the start
// time. The placement is allowed when at least one qualifying guardian covers it.
// If NO guardian has any availability defined, availability is unknown and we do
// not enforce (returns ok). `guardianId`, when given AND it resolves to a real
// guardian (by id or name), restricts to that guardian; an unrecognizable value is
// ignored (we check all guardians) rather than rejecting every placement.
// Returns { ok, reason }. Pure/exported.
export function evaluatePlacement({ guardians, dateKey, scheduledTime, guardianId }) {
  const norm = (guardians || []).map((g) => ({
    id: g.id, name: g.name || g.id, win: normalizeGuardianAvailability(g.availability),
  }));
  if (!norm.some((g) => g.win)) return { ok: true }; // nobody constrained → don't enforce

  const day = new Date(dateKey + "T00:00:00Z").getUTCDay();
  const dow = DOW_KEYS[day];
  const startMin = timeToMinutes(scheduledTime);
  const matchedId = resolveGuardianId(guardians, guardianId);
  const pool = matchedId ? norm.filter((g) => g.id === matchedId) : norm;

  const covers = (g) => {
    if (!g.win) return true; // flexible guardian can take any slot
    if (startMin == null) return false;
    return (g.win[dow] || []).some((sp) => startMin >= sp.s && startMin < sp.e);
  };
  if (pool.some(covers)) return { ok: true };

  // Build a helpful reason listing who CAN facilitate on this weekday.
  const open = [];
  for (const g of norm) {
    if (!g.win) { open.push(`${g.name} (flexible)`); continue; }
    const spans = g.win[dow] || [];
    if (spans.length) open.push(`${g.name} ${spans.map((sp) => `${minutesToTime(sp.s)}-${minutesToTime(sp.e)}`).join(",")}`);
  }
  const matchedName = matchedId ? norm.find((g) => g.id === matchedId)?.name : null;
  const who = matchedName ? `${matchedName} is` : "no guardian is";
  const reason = open.length
    ? `${who} not available on ${DAY_NAMES[day]} at ${scheduledTime}. Available that day: ${open.join("; ")}. ` +
      "Move this block into one of those windows."
    : `No guardian is available on ${DAY_NAMES[day]} — leave that day empty and place this block on another day.`;
  return { ok: false, reason };
}

// Per target dateKey, summarise which guardians can facilitate and when, so the
// agent only places inside real windows and leaves fully-unavailable days empty.
// Pure/exported.
export function availabilityWindowsByDate(guardians, weekDateKeys) {
  const norm = (guardians || []).map((g) => ({
    name: g.name || g.id, win: normalizeGuardianAvailability(g.availability),
  }));
  const anyConstrained = norm.some((g) => g.win);
  return (weekDateKeys || []).map((k) => {
    const day = new Date(k + "T00:00:00Z").getUTCDay();
    const dow = DOW_KEYS[day];
    if (!anyConstrained) return { dateKey: k, label: "any time (availability not set)", available: true };
    const parts = [];
    for (const g of norm) {
      if (!g.win) { parts.push(`${g.name} flexible`); continue; }
      const spans = g.win[dow] || [];
      if (spans.length) parts.push(`${g.name} ${spans.map((sp) => `${minutesToTime(sp.s)}-${minutesToTime(sp.e)}`).join(",")}`);
    }
    const available = parts.length > 0;
    return {
      dateKey: k, weekday: DAY_NAMES[day], available,
      label: available ? parts.join("; ") : "NO GUARDIAN AVAILABLE — leave empty",
    };
  });
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
            forChildId: x.forChildId || "",
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

// Suggested number of placements across ONE week for an activity, derived from
// its content-plan material meta (contentPlan.js). Repeatable memorisation /
// drilling is placed multiple times; everything else once. Pure — exported.
export function weeklyRepeatTarget(material) {
  if (!material || material.repeatable !== true) return 1;
  switch (material.repeatFrequency) {
    case "daily": return 5;       // weekday cadence (Qur'an/qaida memorisation, tables)
    case "weekly": return 1;
    case "biweekly": return 1;    // every other week → once this week
    case "monthly": return 1;
    default: return 1;
  }
}

// Stable key identifying a single placement: the same activity, on the same day,
// for the same child. Used to reject duplicate placements — the agent sometimes
// repeats a schedule_block call (and re-runs pile onto an already-populated day),
// which surfaced as the same activity scheduled 3× in a row on one date. A
// repeatable activity still repeats across DIFFERENT days (different dateKey), and
// a per-child 'individual' activity still gets one block per child (different
// forChildId) — only an exact same-day, same-child repeat is a duplicate. Pure.
export function placementKey(activityId, dateKey, forChildId) {
  return `${activityId}|${dateKey}|${forChildId || ""}`;
}

// Compact material descriptor appended to a pool line so the agent knows how to
// place the activity: repeat cadence + individual-vs-shared. Pure — exported.
export function describeMaterialForPool(material) {
  if (!material) return "";
  const bits = [];
  if (material.repeatable) {
    bits.push(`repeat ${material.repeatFrequency || "daily"} (aim ~${weeklyRepeatTarget(material)}×/week)`);
  }
  if (material.targetingMode === "individual") bits.push("individual — one session per child");
  else if (material.targetingMode === "shared") bits.push("shared — one slot for the group");
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}

const SCHEDULER_BASE_PROMPT = [
  "You are the family's planning assistant. Lay the family's existing activities onto the",
  "calendar for the requested week, creating a realistic, balanced schedule.",
  "",
  "SCHEDULING PRINCIPLES:",
  "- Guardian availability is a HARD constraint, not a preference. Place activities ONLY in a day +",
  "  time when a guardian who can facilitate is available — see 'GUARDIAN AVAILABILITY THIS WEEK'",
  "  below for the exact open windows per day. A day marked 'NO GUARDIAN AVAILABLE' must be left",
  "  completely empty — schedule NOTHING on it. The schedule_block tool will REJECT any placement",
  "  outside these windows, so read them carefully before choosing each day and time.",
  "  If availability is unknown (none set), prefer mornings on weekdays.",
  "- Spread work sensibly across the days; don't cram everything into one day. Aim for a few",
  "  activities per active day, ordered easiest-first within a day.",
  "- Progress complexity over the week (introductory earlier, harder later) where it makes sense.",
  "- Keep each child's daily load age-appropriate; co-op activities can serve multiple children at once.",
  "- Honour activity durations when spacing start times (avoid overlapping the same guardian).",
  "- Everything must serve the family's guiding light.",
  "",
  "REPETITION & PER-CHILD PACING (from each activity's material plan):",
  "- An activity flagged 'repeat <freq> (aim ~N×/week)' is memorisation or drilling — place the SAME",
  "  activity about N times across the week, on separate days. Repeating these is the POINT, so the",
  "  '⚠ already scheduled' caution below does NOT apply to them. Activities with no repeat flag go once.",
  "- NEVER place the same activity more than once on a SINGLE day — spread repeats across different days.",
  "- An activity flagged 'individual' is paced to ONE child: when it targets several children, place a",
  "  SEPARATE block per child using schedule_block's forChildId, so each works at their own level. An",
  "  activity flagged 'shared' (or unflagged co-op) is a single slot for the whole group — place it once.",
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
      guardianId: { type: "string", description: "The guardian who will facilitate — their name or id, as shown in GUARDIAN AVAILABILITY (optional)." },
      forChildId: { type: "string", description: "For an 'individual'-paced activity that targets several children, the SINGLE child id this block is for (creates a per-child session). Omit for shared/group activities." },
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

  // Guardian availability — a HARD constraint. The agent is told the open windows
  // per day AND the schedule_block tool rejects any out-of-window placement, so a
  // soft prompt instruction can't be silently ignored (the original bug: blocks
  // landed on days/times no guardian was available, e.g. Sunday).
  const guardSnap = await p.guardians().limit(20).get();
  const guardians = guardSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const availByDate = availabilityWindowsByDate(guardians, weekDateKeys);

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
      describeMaterialForPool(a.plan?.material) +
      `${placed ? ` · ⚠ already scheduled ${placed}×` : ""}`
    );
  });

  const system = await buildGroundedSystemPrompt(db, familyId, SCHEDULER_BASE_PROMPT, "scheduler");

  // Audit / progress doc.
  const runRef = p.agentRuns().doc();
  await runRef.set({ type: "scheduler", uid, status: "running", weekDateKeys, scheduled: 0, createdAt: new Date() });

  // Placements already on the calendar for THIS week (seeded from history) plus
  // those made during this run. Guards against the same activity landing on the
  // same day for the same child more than once — see placementKey.
  const placedKeys = new Set();
  for (const d of scheduleDays) {
    if (!weekDateKeys.includes(d.date)) continue;
    for (const b of d.blocks || []) {
      if (b.activityId) placedKeys.add(placementKey(b.activityId, d.date, b.forChildId));
    }
  }

  let scheduled = 0;
  const tools = {
    async schedule_block({ activityId, dateKey, scheduledTime, guardianId, forChildId, notes }) {
      const a = activitiesById[activityId];
      if (!a) return { error: `unknown activityId "${activityId}"` };
      if (!weekDateKeys.includes(dateKey)) return { error: `dateKey "${dateKey}" is outside the target week` };

      // Hard availability gate — reject any slot no guardian can facilitate.
      const verdict = evaluatePlacement({ guardians, dateKey, scheduledTime, guardianId });
      if (!verdict.ok) return { error: verdict.reason };

      // Per-child placement for individually-paced activities: when forChildId is
      // given and the activity targets that child (or targets everyone), scope the
      // block to just that child so the player shows their differentiated variant.
      const activityTargets = Array.isArray(a.targetChildren) ? a.targetChildren.filter(Boolean) : [];
      const perChild = forChildId && (!activityTargets.length || activityTargets.includes(forChildId));
      const targetChildren = perChild ? [forChildId] : activityTargets;

      // Reject a same-day, same-child repeat — the agent occasionally calls
      // schedule_block twice for one placement. Repeats must go on a DIFFERENT day.
      const key = placementKey(activityId, dateKey, perChild ? forChildId : "");
      if (placedKeys.has(key)) {
        return {
          error: `"${a.title}" is already placed on ${dateKey}${perChild ? " for that child" : ""}. ` +
            "Repeats belong on a DIFFERENT day — skipping this duplicate.",
        };
      }
      placedKeys.add(key);

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
        targetChildren,
        forChildId: perChild ? forChildId : null,
        durationMinutes: a.durationMinutes || 30,
        scheduledTime: /^\d{1,2}:\d{2}$/.test(scheduledTime || "") ? scheduledTime : "09:00",
        // Store the canonical guardian id, resolving a name the agent may have
        // passed (it only sees names) so the block links to a real guardian.
        guardianId: resolveGuardianId(guardians, guardianId),
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

  // Explicit per-day open windows. Days flagged "leave empty" have no available
  // guardian and the tool will reject any placement on them.
  const availabilityBlock = [
    "",
    "GUARDIAN AVAILABILITY THIS WEEK — schedule ONLY inside these windows:",
    ...availByDate.map((d) => `- ${d.dateKey} (${d.weekday || ""}): ${d.label}`),
  ];

  const userMessage = [
    `Schedule activities for the week: ${weekLine}.`,
    ...availabilityBlock,
    "",
    "ACTIVITIES AVAILABLE (use these activityIds):",
    ...activityLines,
    ...historyBlock,
    "",
    "Place a balanced selection across the week now by calling schedule_block for each one,",
    "keeping every block inside the available windows above.",
  ].join("\n");

  let result;
  try {
    result = await runAgent({
      llm,
      system,
      toolDeclarations: [SCHEDULE_BLOCK_DECLARATION],
      tools,
      userMessage,
      maxSteps: 60,
      generationConfig: genConfig,
    });
  } catch (e) {
    await runRef.set(
      { status: "error", error: String(e?.message || e).slice(0, 500), failedAt: new Date() },
      { merge: true }
    );
    throw e;
  }

  // Observability: a 0-scheduled run is ambiguous (did the model never call the
  // tool, or did every placement get rejected?). Summarise the run so the cause is
  // visible in logs without re-instrumenting — especially while validating a new
  // provider/model where tool-calling reliability differs.
  const blockCalls = (result.steps || []).filter((s) => s.tool === "schedule_block");
  const toolErrors = blockCalls.filter((s) => s.result && s.result.error);
  console.log(
    `[scheduler] model=${llm?.model || "?"} steps=${(result.steps || []).length} ` +
    `schedule_block_calls=${blockCalls.length} rejected=${toolErrors.length} ` +
    `scheduled=${scheduled} stoppedAt=${result.stoppedAt || "?"}`
  );
  if (toolErrors.length) console.log(`[scheduler] first rejection: ${String(toolErrors[0].result.error).slice(0, 300)}`);
  if (!blockCalls.length) console.log(`[scheduler] model placed nothing — final text: ${String(result.text || "").slice(0, 400)}`);

  await runRef.set(
    { status: "done", scheduled, answer: result.text, finishedAt: new Date() },
    { merge: true }
  );

  // The schedule changed — refresh the brief so agents/parents see the new plan.
  await regenerateBriefSafe(db, familyId);

  return { runId: runRef.id, scheduled, text: result.text };
}

export const autoSchedule = onCall({ secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 300 }, async (request) => {
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

  const { llm, genConfig, provider } = await resolveLlm(
    db, "scheduler",
    { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY },
    { familyId, uid, source: "autoSchedule" }
  );
  console.log(`[scheduler] resolved provider=${provider} model=${llm?.model || "none"} (openaiKeyPresent=${Boolean(process.env.OPENAI_API_KEY)})`);
  if (!llm) {
    return { configured: false, text: `The scheduler isn't configured yet — set the ${secretNameForProvider(provider)} secret to enable it.` };
  }

  try {
    const { runId, scheduled, text } = await runAutoSchedule({ db, familyId, uid, weekDateKeys, llm, genConfig });
    return { configured: true, runId, scheduled, text };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/(Gemini|OpenAI) [45]\d\d/.test(msg)) {
      throw new HttpsError("unavailable", `The AI model is temporarily unavailable — please try again in a moment. (${msg.slice(0, 200)})`);
    }
    throw e;
  }
});
