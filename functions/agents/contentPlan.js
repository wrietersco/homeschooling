// Content planning agent — the "plan-first" layer that gives every content
// worker a coherent canvas to paint on.
//
// Problem: content used to be generated per-activity in isolation, so the ~140
// activities never wove into a single learning arc. We fix that WITHOUT asking
// one agent to hold hundreds of activities in context, by planning HIERARCHICALLY
// and one SUBJECT at a time:
//
//   requestContentPlanning (onCall) → runContentPlanning
//     → runSubjectPlan(subject) × N        (one bounded agent call per subject)
//       → writes families/{id}/subjectPlans/{subjectId}
//       → stamps each activity with its { objective, buildsOn, keyContent }
//
// A subject's ~48 one-line objectives fit easily in one context, and cross-
// subject coherence rides in via the guiding light + subject spine. Every
// cross-activity DECISION (which surah, which letters, which vocabulary) is made
// here, in the plan — so the downstream content workers only RENDER a pre-decided
// objective and can run fully in parallel without clashing.
//
// All timestamps use new Date() (admin prototype-clash avoidance).
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm, secretNameForProvider } from "./agentConfig.js";

export const PLAN_VERSION = 1;

// ─── Planning tool ────────────────────────────────────────────────────────────
const RECORD_PLAN_DECLARATION = {
  name: "record_subject_plan",
  description:
    "Record the coherent learning plan for this subject: a plan entry for EVERY listed activity so they interlink into one arc (each builds on the last; none duplicate). Call exactly once.",
  parameters: {
    type: "object",
    properties: {
      coverage: {
        type: "string",
        description: "2-4 sentences describing the whole arc this subject covers across the 6 months, so nothing is duplicated and each step builds on the previous.",
      },
      activities: {
        type: "array",
        description: "One entry per provided activity, in learning order.",
        items: {
          type: "object",
          properties: {
            activityId: { type: "string", description: "The activity id, taken EXACTLY from the provided list." },
            objective: { type: "string", description: "One sentence: precisely what THIS activity teaches or achieves." },
            buildsOn: { type: "string", description: "Short: the prior activity/skill this one builds on." },
            keyContent: { type: "string", description: "The SPECIFIC content this activity must use so it never clashes with siblings — be concrete, e.g. 'Surah Al-Asr ayah 1-3', 'letters Alif to Jeem', 'addition within 10', the exact vocabulary set." },
            // Material meta — how this activity's CONTENT behaves, so the
            // scheduler can decide repetition counts and the differentiation
            // audit knows whether to split per child or keep it shared.
            repeatable: { type: "boolean", description: "true if the child repeats the SAME material across sessions to master it (memorisation: Qur'an / Qaida; drilling: times-tables). false for one-shot content used once (a story read once, a unique experiment or discussion)." },
            repeatFrequency: { type: "string", description: "How often the same material recurs when repeatable: one of 'daily', 'weekly', 'biweekly', 'monthly'. Use 'once' when not repeatable." },
            complexity: { type: "integer", description: "Intrinsic difficulty of THIS material, 1 (easiest) to 5 (hardest) — independent of its position in the arc." },
            targetingMode: { type: "string", description: "'individual' if each child must work this material at their OWN level/pace (so it should be differentiated per child — most skill-paced memorisation, reading and maths); 'shared' if all targeted children genuinely do the same material together (co-op games, group discussion, shared listening)." },
          },
          required: ["activityId", "objective"],
        },
      },
    },
    required: ["activities"],
  },
};

const str = (v) => (typeof v === "string" ? v.trim() : "");

// ─── Material-meta normalizers ────────────────────────────────────────────────
const REPEAT_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "once"];
const TARGETING_MODES = ["individual", "shared"];

function normFrequency(v) {
  const s = str(v).toLowerCase();
  return REPEAT_FREQUENCIES.includes(s) ? s : "";
}
function normTargeting(v) {
  const s = str(v).toLowerCase();
  return TARGETING_MODES.includes(s) ? s : "";
}
function clampComplexity(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : fallback;
}

// Build the material-meta block for one plan entry, with safe defaults. The
// activity's complexity rank is the fallback for material complexity; an
// unrecognised/blank targetingMode stays "" so the differentiation audit falls
// back to its own type heuristic rather than trusting a hallucinated value.
function sanitizeMaterial(entry, rank) {
  const repeatable = entry?.repeatable === true;
  return {
    repeatable,
    repeatFrequency: normFrequency(entry?.repeatFrequency) || (repeatable ? "daily" : "once"),
    complexity: clampComplexity(entry?.complexity, rank),
    targetingMode: normTargeting(entry?.targetingMode),
  };
}

// Order activities the way a child progresses: by complexity rank, then creation.
function orderActivities(list) {
  return [...list].sort((a, b) =>
    (Number(a.complexityRank) || 1) - (Number(b.complexityRank) || 1) ||
    ((a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
  );
}

// Build the stored plan doc shape from the agent's output, keeping ONLY entries
// that match a real activity and preserving learning order. Exported for tests.
export function sanitizeSubjectPlan(orderedActivities, captured) {
  const byId = new Map((Array.isArray(captured?.activities) ? captured.activities : []).map((e) => [str(e.activityId), e]));
  const activities = orderedActivities.map((a) => {
    const e = byId.get(a.id) || {};
    const rank = Number(a.complexityRank) || 1;
    return {
      activityId: a.id,
      title: str(a.title) || "Activity",
      rank,
      objective: str(e.objective),
      buildsOn: str(e.buildsOn),
      keyContent: str(e.keyContent),
      material: sanitizeMaterial(e, rank),
    };
  });
  return { coverage: str(captured?.coverage), activities };
}

// Render a compact, content-worker-facing context string for ONE activity: the
// full sibling arc + this activity's exact job. This is the "canvas". Pure +
// exported so it can be unit-tested and reused by every content path.
export function buildPlanContextString(planDoc, activityId) {
  const seq = planDoc?.activities;
  if (!Array.isArray(seq) || !seq.length) return "";
  const lines = seq.map((a, i) =>
    `${i + 1}. ${a.activityId === activityId ? "► " : ""}"${a.title}" — ${a.objective || "(objective tbd)"}${a.keyContent ? ` [covers: ${a.keyContent}]` : ""}`
  );
  const me = seq.find((a) => a.activityId === activityId);
  const mat = me?.material;
  const matHint = mat
    ? `${mat.repeatable ? ` This material is repeated (${mat.repeatFrequency}) for mastery — make it worth revisiting.` : ""}${mat.targetingMode === "individual" ? " Pitch it to one child's level (it is individually paced)." : ""}`
    : "";
  return [
    "SUBJECT LEARNING PLAN — weave THIS activity into the arc below. Do NOT duplicate what sibling activities cover; build on what comes before and set up what comes after.",
    planDoc.coverage ? `Overall arc: ${planDoc.coverage}` : "",
    "Full sequence (► marks the activity you are creating content for now):",
    ...lines,
    me ? `\nYOUR ACTIVITY (►): ${me.objective || ""}${me.buildsOn ? ` Builds on: ${me.buildsOn}.` : ""}${me.keyContent ? ` Must cover EXACTLY: ${me.keyContent}.` : ""}${matHint}` : "",
    "Deliver precisely this objective and content, and connect naturally to the steps immediately before and after.",
  ].filter(Boolean).join("\n");
}

// Read all stored subject plans → Map(subjectId -> planDoc). Used by content
// workers to fetch their canvas in one collection read per pass.
export async function loadSubjectPlans(db, familyId) {
  const map = new Map();
  try {
    const snap = await db.collection("families").doc(familyId).collection("subjectPlans").limit(100).get();
    for (const d of snap.docs) map.set(d.id, d.data());
  } catch { /* best-effort — content still generates without a plan */ }
  return map;
}

function buildPlanPrompt({ subjectName, macroGoals = [], contentOutline = "", guidingLight, children, activityLines }) {
  return [
    "You design a COHERENT 6-month learning plan for ONE subject so its activities interlink into a single arc — each builds on the last, none duplicate.",
    "",
    `SUBJECT: ${subjectName}`,
    macroGoals.length ? `Goals: ${macroGoals.join("; ")}` : "",
    contentOutline ? `Outline: ${contentOutline}` : "",
    `Guiding light (every activity must serve this): ${guidingLight || "(not set)"}`,
    `Children: ${children.map((c) => `${c.name || c.id}${c.dob ? ` (dob ${c.dob})` : ""}`).join("; ") || "(none)"}`,
    "",
    "ACTIVITIES (already created, ordered by complexity — give a plan entry for EACH using these EXACT ids):",
    ...activityLines,
    "",
    "For every activity set: a one-sentence objective, what it builds on, and the SPECIFIC content it must cover (be concrete — exact surah/ayah, exact letters, the math skill, the vocabulary set).",
    "ALSO set each activity's material meta: repeatable (does the child repeat the SAME item to master it — memorisation/drilling — or is it one-shot), repeatFrequency, complexity (1-5 intrinsic difficulty), and targetingMode ('individual' = each child works it at their own level so it must be differentiated per child; 'shared' = all targeted children genuinely do it together). Skill-paced memorisation/reading/maths is usually 'individual'; co-op games and group discussion are 'shared'.",
    "Guarantee a rank 1→5 progression and that no two activities cover the same specific content unless it is deliberate revision.",
    "Call record_subject_plan exactly once. Write no prose outside the tool call.",
  ].filter(Boolean).join("\n");
}

// ─── Plan one subject ─────────────────────────────────────────────────────────
export async function runSubjectPlan({ db, familyId, subjectId, subjectName, activities, macroGoals, contentOutline, guidingLight, children, llm, genConfig }) {
  const ordered = orderActivities(activities);
  const activityLines = ordered.map((a) => `- ${a.id} · rank ${a.complexityRank || 1} · "${a.title}" · ${a.type || "teaching"}`);

  let captured = null;
  const tools = { async record_subject_plan(args) { captured = args || {}; return { saved: true }; } };
  const system = buildPlanPrompt({ subjectName, macroGoals, contentOutline, guidingLight, children, activityLines });
  await runAgent({
    llm, system,
    toolDeclarations: [RECORD_PLAN_DECLARATION],
    tools,
    userMessage: `Design the plan for "${subjectName}" now and call record_subject_plan once with an entry for every activity.`,
    maxSteps: 4,
    generationConfig: genConfig ?? { maxOutputTokens: 8192, temperature: 0.3 },
  });

  const plan = sanitizeSubjectPlan(ordered, captured || {});
  const planDoc = {
    subjectId,
    subjectName,
    planVersion: PLAN_VERSION,
    coverage: plan.coverage,
    activities: plan.activities,
    generatedAt: new Date(),
  };
  await db.collection("families").doc(familyId).collection("subjectPlans").doc(subjectId).set(planDoc);

  // Stamp each activity with its own plan slice (so single-activity content can
  // read its job without loading the whole subject plan) + the plan version.
  const batch = db.batch();
  for (const e of plan.activities) {
    batch.update(db.collection("families").doc(familyId).collection("activities").doc(e.activityId), {
      plan: { objective: e.objective, buildsOn: e.buildsOn, keyContent: e.keyContent, material: e.material },
      planVersion: PLAN_VERSION,
    });
  }
  await batch.commit();

  return { subjectId, activityCount: plan.activities.length };
}

// ─── Plan every subject (live progress) ───────────────────────────────────────
export async function runContentPlanning({ db, familyId, uid, role = "owner", llm, genConfig, onlySubjectId = "" }) {
  const famRef = db.collection("families").doc(familyId);
  const [activitiesSnap, profileSnap, childrenSnap] = await Promise.all([
    famRef.collection("activities").limit(500).get(),
    famRef.collection("profile").doc("family").get(),
    famRef.collection("children").limit(30).get(),
  ]);
  const activities = activitiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!activities.length) throw new HttpsError("failed-precondition", "Generate a syllabus first — there are no activities to plan.");
  const guidingLight = profileSnap.exists ? (profileSnap.data().guidingLight || "") : "";
  const children = childrenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Group activities by subject (derived from the activities themselves).
  const bySubject = new Map();
  for (const a of activities) {
    const sid = a.subjectId || "__unknown__";
    if (onlySubjectId && sid !== onlySubjectId) continue;
    if (!bySubject.has(sid)) bySubject.set(sid, { subjectId: sid, subjectName: a.subject || sid, curriculumId: a.curriculumId || "", items: [] });
    bySubject.get(sid).items.push(a);
  }
  const subjects = [...bySubject.values()];
  if (!subjects.length) throw new HttpsError("failed-precondition", "No matching subject to plan.");

  // Progress doc, same language as the other agent runs.
  const runRef = famRef.collection("agentRuns").doc();
  const subjState = {};
  for (const s of subjects) subjState[s.subjectId] = { name: s.subjectName, status: "pending", activityCount: 0 };
  await runRef.set({
    type: "contentplan", uid, role, status: "running",
    subjects: subjState, totalSubjects: subjects.length, completedSubjects: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });

  let completed = 0;
  for (const s of subjects) {
    await runRef.update({ [`subjects.${s.subjectId}.status`]: "running", currentSubjectId: s.subjectId, updatedAt: new Date() });
    try {
      // Best-effort spine: the curriculum subject doc carries macroGoals/outline.
      let macroGoals = [], contentOutline = "";
      if (s.curriculumId) {
        const subDoc = await famRef.collection("curriculum").doc(s.curriculumId).collection("subjects").doc(s.subjectId).get().catch(() => null);
        if (subDoc?.exists) { macroGoals = subDoc.data().macroGoals || []; contentOutline = subDoc.data().contentOutline || ""; }
      }
      const { activityCount } = await runSubjectPlan({
        db, familyId, subjectId: s.subjectId, subjectName: s.subjectName, activities: s.items,
        macroGoals, contentOutline, guidingLight, children, llm, genConfig,
      });
      completed += 1;
      await runRef.update({
        [`subjects.${s.subjectId}.status`]: "done",
        [`subjects.${s.subjectId}.activityCount`]: activityCount,
        completedSubjects: completed, currentSubjectId: null, updatedAt: new Date(),
      });
    } catch (e) {
      await runRef.update({
        [`subjects.${s.subjectId}.status`]: "error",
        [`subjects.${s.subjectId}.error`]: String(e?.message || e).slice(0, 300),
        currentSubjectId: null, updatedAt: new Date(),
      });
    }
  }
  await runRef.update({ status: "done", finishedAt: new Date(), updatedAt: new Date() });
  return { runId: runRef.id, totalSubjects: subjects.length, completedSubjects: completed };
}

// ─── Callable ─────────────────────────────────────────────────────────────────
export const requestContentPlanning = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    if (!["owner", "parent"].includes(role)) {
      throw new HttpsError("permission-denied", "Only family owners or parents can plan content.");
    }
    const onlySubjectId = String(request.data?.subjectId || "").trim();
    const { llm, genConfig, provider } = await resolveLlm(
      db, "curriculum",
      { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY },
      { familyId, uid, source: "requestContentPlanning" }
    );
    if (!llm) return { configured: false, text: `The planning agent isn't configured — set the ${secretNameForProvider(provider)} secret to enable it.` };
    const res = await runContentPlanning({ db, familyId, uid, role, llm, genConfig, onlySubjectId });
    return { configured: true, ...res };
  }
);
