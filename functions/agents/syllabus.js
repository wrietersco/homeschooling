// Syllabus builder — generates a complexity-graded activity series for every
// subject in an active curriculum. Architecture:
//
//   generateSyllabus (onCall) → runSyllabus (master)
//     → runSyllabusWorker (per-subject) × N
//       → create_activity tool × 4-6 calls per subject
//
// Progress is written to agentRuns/{runId} after every subject so the client
// can subscribe via onSnapshot for live updates while the callable is still
// running. All timestamps use new Date() (not FieldValue.serverTimestamp) so
// the functions-level and root-level admin packages never prototype-clash.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm, secretNameForProvider } from "./agentConfig.js";
import { loadPlatformInstructions, describeGuardian, summarizeChildPerformance } from "./grounding.js";
import { generateContentForActivity, clampGuidance } from "./activityContent.js";
import { regenerateBriefSafe } from "./knowledgeBrief.js";
import { consumePlanUsage, savePreparedActivity } from "../lib/subscriptions.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";

// The three text-provider API keys, read fresh each call so a resolveLlm() can
// route to whichever provider the "syllabus"/"content" agent is configured for.
function providerKeys() {
  return { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
}

const DEFAULT_ACTIVITIES_PER_SUBJECT = 48;
const DEFAULT_BATCH_ACTIVITIES = 4;
const QUEUE_COLLECTION = "syllabusQueue";
// A subject that errors this many times is marked terminally "failed" so a single
// persistently-broken subject can never loop the run forever (audit #3). Other
// subjects still complete; the run finishes with the failed subject recorded.
const MAX_SUBJECT_ATTEMPTS = 3;

// A subject is "terminal" (no longer actionable) when done or permanently failed.
function isSubjectTerminal(s) {
  return s && (s.status === "done" || s.status === "failed");
}

// Default subjects seeded into EVERY curriculum so they are always listed and
// selectable, whether or not the curriculum interview included them. Seeding is
// optional by design: a seeded subject stays DORMANT (matched:false, skipped by
// builds) until the parent explicitly generates activities for it, so adding
// this catalog later is backwards compatible with existing curricula — nothing
// is generated for these subjects unless the parent asks for it.
export const DEFAULT_SUBJECT_NAMES = ["Geography", "Social Studies", "History", "Politics"];

// Idempotently create the default subject docs (matched by case-insensitive
// name) and keep the curriculum doc's subjectCount honest. Returns the names
// that were actually added.
export async function ensureDefaultSubjectDocs({ db, familyId, curriculumId }) {
  const famRef = db.collection("families").doc(familyId);
  const subRef = famRef.collection("curriculum").doc(curriculumId).collection("subjects");
  const snap = await subRef.get();
  const existing = new Set(snap.docs.map((d) => String(d.data().name || "").trim().toLowerCase()));
  const missing = DEFAULT_SUBJECT_NAMES.filter((n) => !existing.has(n.toLowerCase()));
  if (!missing.length) return { added: [] };

  const batch = db.batch();
  for (const name of missing) {
    // Same field shape finalize_curriculum writes, so every downstream reader
    // (worker prompt, plan spine, curriculum view) sees a normal subject doc.
    batch.set(subRef.doc(), {
      name,
      macroGoals: [],
      contentOutline: "",
      instructionApproach: "",
      assessmentMethod: "",
      gradingStandards: "",
      targetChildren: [],
      default: true, // dormant marker — skipped by builds until activated
      createdAt: new Date(),
    });
  }
  batch.update(famRef.collection("curriculum").doc(curriculumId), {
    subjectCount: snap.size + missing.length,
  });
  await batch.commit();
  return { added: missing };
}

// Coerce whatever the model put in `targetChildren` into REAL child document ids.
// The model only ever sees child names (not ids), so it tends to return names,
// guessed ids, or "for X" phrases — none of which match the children collection.
// We map names → ids (exact, then substring), keep valid ids, and fall back to
// "all children" when nothing resolves. Without this, the player and planner
// can't tell which child an activity is for. Exported for reuse + tests.
export function resolveTargetChildren(children, raw) {
  const ids = new Set(children.map((c) => c.id));
  const byName = new Map(
    children.map((c) => [String(c.name || "").trim().toLowerCase(), c.id]).filter(([n]) => n)
  );
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (ids.has(s)) { out.push(s); continue; }
    const lc = s.toLowerCase();
    if (byName.has(lc)) { out.push(byName.get(lc)); continue; }
    // Word-boundary match only — a raw substring `includes` falsely matched short
    // names inside longer tokens (e.g. "An"/"Sam", or "Sara" inside "Sarah").
    // Tokenise the phrase and require a whole-word hit (single- or multi-word name).
    const tokens = lc.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let matched = false;
    for (const [name, id] of byName) {
      const nameTokens = name.split(/\s+/).filter(Boolean);
      if (!nameTokens.length) continue;
      if (containsSubsequence(tokens, nameTokens)) { out.push(id); matched = true; break; }
    }
    if (matched) continue;
  }
  const uniq = [...new Set(out)];
  return uniq.length ? uniq : children.map((c) => c.id);
}

// True if `needle` (an ordered list of name tokens) appears as a contiguous run
// of whole words inside `hay` (the phrase's tokens). Whole-word, order-preserving.
function containsSubsequence(hay, needle) {
  if (needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// ─── Activity type enum ───────────────────────────────────────────────────────
// `quran` is recitation/memorisation of ACTUAL verses ONLY. Arabic literacy
// (letters, phonics, words) is `arabic_reading` / `noorani_qaida`, never `quran`.
// Reading is split per language so each gets its own pedagogy, script direction,
// and resources. `story_reading` is kept only as a legacy alias.
const ACTIVITY_TYPES = [
  "quran", "noorani_qaida",
  "arabic_reading", "urdu_reading", "english_reading", "conversation",
  "mathematics", "computer", "ai_robotics", "physical", "teaching",
];

// ─── Tool declaration for the per-subject worker ─────────────────────────────
const CREATE_ACTIVITY_DECLARATION = {
  name: "create_activity",
  description:
    "Create one activity in the syllabus for this subject. Call this 4-6 times to build a complexity-graded series from basic (rank 1) to advanced (rank 5). Each activity should be a distinct, practical task a parent can facilitate at home.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, descriptive title." },
      type: {
        type: "string",
        description: `Activity type. One of: ${ACTIVITY_TYPES.join(", ")}.`,
      },
      complexityRank: {
        type: "number",
        description:
          "1 = introductory (early weeks), 2 = basic, 3 = intermediate, 4 = advanced, 5 = deep mastery (end of 6 months).",
      },
      coopMode: {
        type: "boolean",
        description: "True if siblings can do this activity together.",
      },
      targetChildren: {
        type: "array",
        items: { type: "string" },
        description: "Child IDs from the family. List all for co-op activities.",
      },
      parentInstructions: {
        type: "string",
        description: "Step-by-step instructions for the parent, in English. Be concrete and actionable.",
      },
      parentInstructionsTranslit: {
        type: "string",
        description: "ONLY when a parent mother tongue is given: the parentInstructions written in that mother tongue but in Latin/English transliteration, so a parent who cannot read the native script can still read it. Omit otherwise.",
      },
      parentInstructionsNative: {
        type: "string",
        description: "ONLY when a parent mother tongue is given: the parentInstructions in that mother tongue's native script (used for audio playback). Omit otherwise.",
      },
      exampleWalkthrough: {
        type: "string",
        description: "A concrete example of one session — what the parent says, does, and checks.",
      },
      durationMinutes: {
        type: "number",
        description: "Estimated session length in minutes (10–60).",
      },
    },
    required: ["title", "type", "complexityRank", "parentInstructions"],
  },
};

// ─── Worker system prompt ─────────────────────────────────────────────────────
function buildWorkerSystemPrompt({ subjectName, macroGoals, contentOutline, instructionApproach, assessmentMethod, children, guardians, guidingLight, motherTongue = "", childPerformance = "", platformInstructions, existingTitles, activitiesNeeded = 5, targetActivityCount = 4, onlyTypes = [], guidance = "" }) {
  const lines = [
    platformInstructions || "",
    platformInstructions ? "" : "",
    `You are generating a 6-month activity syllabus for the subject: **${subjectName}**.`,
    "",
    "FAMILY CONTEXT:",
    `Guiding light: ${guidingLight || "(not set)"} — every activity must visibly reflect this.`,
    guardians && guardians.length ? `Guardians (parents/teachers):\n${guardians.join("\n")}` : "",
    `Children: ${children.map((c) => `${c.name || c.id} [id: ${c.id}]${c.dob ? ` (dob ${c.dob})` : ""}`).join("; ") || "(none)"}`,
    children.length ? "When setting `targetChildren`, use the bracketed [id: …] values above — never names." : "",
    childPerformance || "",
    childPerformance ? "Tailor each activity's difficulty and `targetChildren` to the progress above (completion-focused; never rank children)." : "",
    "",
    "SUBJECT CONTEXT:",
    `Macro goals: ${(macroGoals || []).join("; ") || "(none)"}`,
    contentOutline ? `Content outline: ${contentOutline}` : "",
    instructionApproach ? `Instruction approach: ${instructionApproach}` : "",
    assessmentMethod ? `Assessment: ${assessmentMethod} (completion-focused, never inter-child ranking)` : "",
    "",
    existingTitles.length
      ? `EXISTING ACTIVITIES (do NOT duplicate these):\n${existingTitles.map((t) => `- ${t}`).join("\n")}`
      : "",
    "",
    `YOUR TASK: Call create_activity exactly ${activitiesNeeded} time${activitiesNeeded === 1 ? "" : "s"}.`,
    `This subject is being built toward ${targetActivityCount} total activities over the 6-month curriculum.`,
    existingTitles.length ? `Already created for this subject: ${existingTitles.length}.` : "",
    existingTitles.length
      ? "You are filling a partial/resumed syllabus. Do not recreate existing activities; create only the missing next activities."
      : "",
    onlyTypes.length
      ? `Only create activities of these type(s): ${onlyTypes.join(", ")}. Do not create any other type.`
      : "",
    "  Rank 1 — introductory: first 2 weeks, minimal prerequisites.",
    "  Rank 2 — basic: consolidation, builds on rank 1.",
    "  Rank 3 — intermediate: mid-term, stretches capability.",
    "  Rank 4 — advanced: near end, deeper engagement.",
    "  Rank 5 — mastery/synthesis: final 2 weeks, everything comes together.",
    "Each activity must align with the guiding light and be practical for a home setting.",
    "Assessment is always completion-focused — never compare children to each other.",
    "",
    "ACTIVITY TYPE RULES (choose `type` carefully):",
    "- `quran` is ONLY for reciting/memorising actual Qur'anic verses. NEVER use it for",
    "  Arabic letters, phonics, or letter-sound games — those are `arabic_reading` (or",
    "  `noorani_qaida` for the Qaida method).",
    "- Reading is per-language: `arabic_reading`, `urdu_reading`, `english_reading` — make",
    "  them SEPARATE activities, each with language-appropriate pedagogy (Arabic & Urdu are",
    "  right-to-left; phonics/letter-recognition for early ranks, vocabulary + comprehension",
    "  later). Do not bundle multiple languages into one reading activity.",
    "- Use `conversation` for Listening & Speaking activities built around a spoken dialogue/",
    "  scene (e.g. a daily-routine conversation). The app renders these as a playable, two-",
    "  voice conversation — prefer it over `teaching` whenever the activity is a conversation.",
    "- Use `teaching` for hands-on/discussion activities that have no single reading/recitation",
    "  artifact. The app then generates a READY-TO-RUN kit for these — and when the activity",
    "  needs a story, scenario, or role-play, the app writes that material out in full. So in",
    "  `parentInstructions` describe how to FACILITATE the activity; never tell the parent to",
    "  go find, select, choose, or prepare a story/material themselves — assume it is provided.",
    motherTongue ? [
      "PARENT LANGUAGE (mother tongue):",
      `- The guiding parent's mother tongue is ${motherTongue}. For EVERY activity, besides the English parentInstructions, also fill:`,
      `  • parentInstructionsTranslit — the same instructions in ${motherTongue} but written in Latin/English transliteration (so a parent who can't read the native script can still read it).`,
      `  • parentInstructionsNative — the same instructions in ${motherTongue}'s native script (used for audio playback).`,
    ].join("\n") : "",
    guidance ? [
      "",
      "PARENT'S INSTRUCTIONS FOR THIS BATCH (follow these closely — they say what the parent wants from these specific activities):",
      guidance,
    ].join("\n") : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// ─── Per-subject worker (exported for integration tests) ──────────────────────
export async function runSyllabusWorker({
  db, familyId, curriculumId, subjectId, uid, llm, genConfig, contentLlm, contentGenConfig,
  targetActivitiesPerSubject = DEFAULT_ACTIVITIES_PER_SUBJECT,
  batchActivities = DEFAULT_BATCH_ACTIVITIES,
  onlyTypes = [],
  guidance = "",
}) {
  // Load subject data from the curriculum's subjects subcollection.
  const subjectSnap = await db
    .collection("families").doc(familyId)
    .collection("curriculum").doc(curriculumId)
    .collection("subjects").doc(subjectId).get();
  if (!subjectSnap.exists) throw new Error(`Subject ${subjectId} not found in curriculum ${curriculumId}`);
  const subject = subjectSnap.data();

  // Load children, guardians, family profile, and superadmin syllabus instructions
  // so the worker shares the same grounding contract as the other agents.
  const [childrenSnap, guardiansSnap, profileSnap, platformInstructions] = await Promise.all([
    db.collection("families").doc(familyId).collection("children").limit(20).get(),
    db.collection("families").doc(familyId).collection("guardians").limit(20).get(),
    db.collection("families").doc(familyId).collection("profile").doc("family").get(),
    loadPlatformInstructions(db, "syllabus"),
  ]);
  const children = childrenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const guardians = guardiansSnap.docs.map((d) => describeGuardian(d.data(), d.id));
  const guidingLight = profileSnap.exists ? (profileSnap.data().guidingLight || "") : "";
  // Parent mother tongue (#9): first guardian who has one set drives the language
  // of the transliterated/spoken parent instructions.
  const motherTongue = guardiansSnap.docs
    .map((d) => d.data().motherTongue)
    .find((m) => m && String(m).trim()) || "";
  // Per-child performance (#8) — read ONCE here and reused for the whole batch
  // (both the worker prompt and each activity's content generation).
  const childPerformance = await summarizeChildPerformance(db, familyId, children);

  // Load any existing activities for this subject to avoid duplication.
  const existingSnap = await db
    .collection("families").doc(familyId)
    .collection("activities")
    .where("subjectId", "==", subjectId).get();
  const existingTitles = existingSnap.docs.map((d) => d.data().title).filter(Boolean);
  const existingCount = existingSnap.size;
  const targetActivityCount = Math.max(1, Number(targetActivitiesPerSubject) || DEFAULT_ACTIVITIES_PER_SUBJECT);
  const activitiesNeeded = Math.min(
    Math.max(1, Number(batchActivities) || DEFAULT_BATCH_ACTIVITIES),
    Math.max(0, targetActivityCount - existingCount)
  );
  if (activitiesNeeded <= 0) {
    return {
      text: `Subject already has ${existingCount} activities.`,
      activitiesCreated: [],
      subjectName: subject.name,
      existingCount,
      targetActivityCount,
      totalSubjectActivities: existingCount,
    };
  }

  const activitiesCreated = [];
  const activitiesRef = db.collection("families").doc(familyId).collection("activities");

  // Tool: create_activity — writes directly to Firestore.
  const tools = {
    async create_activity({ title, type, complexityRank, coopMode, targetChildren, parentInstructions, parentInstructionsTranslit, parentInstructionsNative, exampleWalkthrough, durationMinutes }) {
      const fallbackType = onlyTypes.length ? onlyTypes[0] : "teaching";
      const resolvedType = ACTIVITY_TYPES.includes(type) && (!onlyTypes.length || onlyTypes.includes(type))
        ? type
        : fallbackType;
      const activityDoc = {
        title: String(title || "Untitled"),
        type: resolvedType,
        subject: subject.name || subjectId,
        subjectId,
        curriculumId,
        complexityRank: Math.min(5, Math.max(1, Number(complexityRank) || 1)),
        coopMode: Boolean(coopMode),
        targetChildren: resolveTargetChildren(children, targetChildren),
        parentInstructions: String(parentInstructions || ""),
        parentInstructionsTranslit: String(parentInstructionsTranslit || ""),
        parentInstructionsNative: String(parentInstructionsNative || ""),
        exampleWalkthrough: String(exampleWalkthrough || ""),
        durationMinutes: Math.min(120, Math.max(5, Number(durationMinutes) || 30)),
        status: "available",
        createdAt: new Date(),
        createdBy: uid,
      };

      // Provision the type-specific, ready-to-do content (verses / problems /
      // story / qaida drills / steps) at creation time so the activity arrives
      // complete. Uses the dedicated 'content' agent runtime; when none is wired
      // (e.g. unit tests inject only a syllabus fake), creation proceeds without
      // inline content and it can be backfilled later. A content failure must
      // leave a draft for later backfill; subscription/quota failures stop work.
      const ref = activitiesRef.doc();
      if (contentLlm) {
        try {
          const { kind, content, provider, model } = await generateContentForActivity({
            activity: { id: ref.id, ...activityDoc }, children, guardians, guidingLight, childPerformance, uid,
            llm: contentLlm,
            genConfig: contentGenConfig,
            db,
            geminiApiKey: process.env.GEMINI_API_KEY || "",
            storagePrefix: familyId,
            guidance,
          });
          if (content) {
            activityDoc.content = content;
            activityDoc.contentGeneratedAt = new Date();
            activityDoc.contentProvider = provider || "";
            activityDoc.contentModel = model || "";
          } else {
            activityDoc.contentKind = kind; // record intended kind even if generation came back empty
          }
        } catch (e) {
          if (["resource-exhausted", "permission-denied", "failed-precondition", "unavailable"].includes(e?.code)) throw e;
          activityDoc.contentError = String(e?.message || e).slice(0, 300);
        }
      }

      if (activityDoc.content) await savePreparedActivity(db, familyId, ref, activityDoc, uid);
      else await ref.set(activityDoc);
      activitiesCreated.push({ id: ref.id, title, complexityRank: Number(complexityRank) || 1 });
      return { id: ref.id, created: true, contentProvisioned: Boolean(activityDoc.content) };
    },
  };

  const system = buildWorkerSystemPrompt({
    subjectName: subject.name,
    macroGoals: subject.macroGoals,
    contentOutline: subject.contentOutline,
    instructionApproach: subject.instructionApproach,
    assessmentMethod: subject.assessmentMethod,
    children,
    guardians,
    guidingLight,
    motherTongue,
    childPerformance,
    platformInstructions,
    existingTitles,
    activitiesNeeded,
    targetActivityCount,
    onlyTypes,
    guidance,
  });

  const result = await runAgent({
    llm,
    system,
    toolDeclarations: [CREATE_ACTIVITY_DECLARATION],
    tools,
    userMessage: `Generate the missing activity series items for "${subject.name || subjectId}" now. Call create_activity exactly ${activitiesNeeded} time${activitiesNeeded === 1 ? "" : "s"}, progressing toward complexity rank 5 (mastery) without duplicating existing activities.${onlyTypes.length ? ` Only create activities of type: ${onlyTypes.join(", ")}.` : ""}`,
    maxSteps: Math.max(6, activitiesNeeded + 4),
    generationConfig: genConfig,
  });

  return {
    text: result.text,
    activitiesCreated,
    subjectName: subject.name,
    existingCount,
    targetActivityCount,
    totalSubjectActivities: existingCount + activitiesCreated.length,
  };
}

export function allocateActivityBudget(subjects, existing, budget) {
  const allocations = Object.fromEntries(Object.keys(subjects).map(id => [id, 0]));
  let remaining = Math.max(0, Math.floor(budget));
  while (remaining > 0) {
    let changed = false;
    for (const [id, s] of Object.entries(subjects)) {
      if (s.matched === false || (existing[id] || 0) + allocations[id] >= s.targetActivityCount) continue;
      allocations[id]++; remaining--; changed = true;
      if (!remaining) break;
    }
    if (!changed) break;
  }
  return allocations;
}

// ─── Master runner (exported for integration tests) ───────────────────────────
export async function startSyllabusRun({
  db,
  familyId,
  curriculumId,
  uid,
  role = "owner",
  targetActivitiesPerSubject = DEFAULT_ACTIVITIES_PER_SUBJECT,
  batchActivities = DEFAULT_BATCH_ACTIVITIES,
  activityBudget = Infinity,
}) {
  // Make sure the default subject catalog exists (idempotent) so the parent
  // always sees — and can top-up — Geography/Social Studies/History/Politics.
  await ensureDefaultSubjectDocs({ db, familyId, curriculumId });

  // Load subjects from the curriculum.
  const subjectsSnap = await db
    .collection("families").doc(familyId)
    .collection("curriculum").doc(curriculumId)
    .collection("subjects").get();
  if (subjectsSnap.empty) throw new Error("No subjects found in this curriculum — add subjects first.");

  // Existing activity counts decide which seeded defaults are still dormant
  // (never generated for) — those are pre-marked done so a full build only
  // creates activities for subjects the parent actually opted into.
  const activitiesSnap = await db
    .collection("families").doc(familyId)
    .collection("activities")
    .where("curriculumId", "==", curriculumId).get();
  const countsBySubject = {};
  for (const d of activitiesSnap.docs) {
    const a = d.data();
    countsBySubject[a.subjectId] = (countsBySubject[a.subjectId] || 0) + 1;
  }
  let dormantCount = 0;

  // Build the initial subjects map for the progress doc.
  const subjectsMap = {};
  for (const d of subjectsSnap.docs) {
    const s = d.data();
    const dormant = Boolean(s.default) && (countsBySubject[d.id] || 0) === 0;
    if (dormant) dormantCount += 1;
    subjectsMap[d.id] = {
      name: s.name || d.id,
      status: dormant ? "done" : "pending",
      activityCount: 0,
      targetActivityCount: targetActivitiesPerSubject,
      ...(dormant ? { matched: false } : {}),
    };
  }

  if (Number.isFinite(activityBudget)) {
    const allocations = allocateActivityBudget(subjectsMap, countsBySubject, activityBudget);
    for (const [id, n] of Object.entries(allocations)) {
      const subject = subjectsMap[id];
      subject.activityCount = countsBySubject[id] || 0;
      subject.targetActivityCount = subject.activityCount + n;
      if (!n) subject.status = "done";
    }
  }
  // Create the agent-run progress doc.
  const activeCount = subjectsSnap.size - dormantCount;
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc();
  await runRef.set({
    type: "syllabus",
    uid,
    role,
    curriculumId,
    status: "queued",
    subjects: subjectsMap,
    totalSubjects: activeCount,
    completedSubjects: dormantCount,
    totalActivities: 0,
    targetActivitiesPerSubject,
    batchActivities,
    targetTotalActivities: Object.values(subjectsMap).filter(s => s.matched !== false).reduce((sum, s) => sum + s.targetActivityCount, 0),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection(QUEUE_COLLECTION).doc(runRef.id).set({
    familyId,
    runId: runRef.id,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Report only ACTIVE subjects — dormant seeded defaults are skipped by the
  // build and pre-marked done, so they aren't part of the work being started.
  return { runId: runRef.id, totalSubjects: activeCount, status: "queued", done: false };
}

// ─── "Generate more activities" (type- or subject-scoped top-up) ─────────────
// Reuses the same agentRuns/syllabusQueue/syllabusWorker machinery as a full
// syllabus build (see startSyllabusRun above), so it gets live progress, retry,
// and stop/cancel for free. The only difference is per-subject scoping: pass
// onlyTypes to touch just the subjects that already contain those type(s), or
// onlySubjects to touch exactly those subjectIds (any activity type). Either
// way each matched subject's targetActivityCount is seeded as "current total +
// addCount" so the existing gap-based logic in runSyllabusWorker creates
// exactly addCount new activities, then stops.
export async function startActivityTopUp({
  db, familyId, curriculumId, uid, role = "owner", onlyTypes, onlySubjects, addCount, guidance: rawGuidance, activityBudget = Infinity,
}) {
  const types = Array.isArray(onlyTypes) ? onlyTypes.filter((t) => ACTIVITY_TYPES.includes(t)) : [];
  const subjectFilter = Array.isArray(onlySubjects)
    ? [...new Set(onlySubjects.map((s) => String(s || "").trim()).filter(Boolean))]
    : [];
  if (!types.length && !subjectFilter.length) {
    throw new HttpsError("invalid-argument", "onlyTypes or onlySubjects must include at least one entry.");
  }
  const count = Math.min(12, Math.max(1, Number(addCount) || DEFAULT_BATCH_ACTIVITIES));
  // Optional parent instructions for these specific activities — clamped like
  // all content guidance so a crafted client can't blow up the worker prompt.
  const guidance = clampGuidance(rawGuidance);

  // Idempotent: makes sure the default subject catalog exists so a subject
  // top-up can target a default subject the curriculum interview never created.
  await ensureDefaultSubjectDocs({ db, familyId, curriculumId });

  const subjectsSnap = await db
    .collection("families").doc(familyId)
    .collection("curriculum").doc(curriculumId)
    .collection("subjects").get();
  if (subjectsSnap.empty) throw new Error("No subjects found in this curriculum — add subjects first.");

  const activitiesSnap = await db
    .collection("families").doc(familyId)
    .collection("activities")
    .where("curriculumId", "==", curriculumId).get();
  const countsBySubject = {};   // subjectId -> total activity count (any type)
  const hasTypeBySubject = {};  // subjectId -> true if it has >=1 activity of a requested type
  for (const d of activitiesSnap.docs) {
    const a = d.data();
    countsBySubject[a.subjectId] = (countsBySubject[a.subjectId] || 0) + 1;
    if (types.includes(a.type)) hasTypeBySubject[a.subjectId] = true;
  }

  // Build the subjects map: only matched subjects get a real target; the rest
  // are pre-marked "done" so the existing per-subject loop in
  // continueSyllabusRun skips them with no extra code path. Matched = selected
  // by id (onlySubjects mode) or already holding a requested type (onlyTypes).
  const subjectsMap = {};
  let matchingSubjects = 0;
  for (const d of subjectsSnap.docs) {
    const existing = countsBySubject[d.id] || 0;
    const matches = subjectFilter.length ? subjectFilter.includes(d.id) : Boolean(hasTypeBySubject[d.id]);
    if (matches) matchingSubjects += 1;
    subjectsMap[d.id] = {
      name: d.data().name || d.id,
      status: matches ? "pending" : "done",
      activityCount: existing,
      targetActivityCount: matches ? existing + count : existing,
      // Lets the client distinguish "matched this top-up, finished" from
      // "never targeted" once both end up with activityCount === target.
      matched: matches,
    };
  }
  if (!matchingSubjects) {
    throw new HttpsError(
      "failed-precondition",
      subjectFilter.length
        ? "None of the selected subjects exist in this curriculum."
        : "None of the existing subjects have an activity of the selected type(s) yet — generate the syllabus first."
    );
  }

  if (matchingSubjects * count > activityBudget) throw new HttpsError("resource-exhausted", `This request needs ${matchingSubjects * count} activities; ${activityBudget} remain available today. Choose fewer activities or subjects.`);
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc();
  await runRef.set({
    type: "syllabus",
    mode: "topup",
    onlyTypes: types,
    ...(subjectFilter.length ? { onlySubjects: subjectFilter } : {}),
    ...(guidance ? { guidance } : {}),
    addCount: count,
    uid,
    role,
    curriculumId,
    status: "queued",
    subjects: subjectsMap,
    totalSubjects: subjectsSnap.size,
    completedSubjects: subjectsSnap.size - matchingSubjects,
    totalActivities: Object.values(subjectsMap).reduce((sum, s) => sum + Number(s.activityCount || 0), 0),
    targetActivitiesPerSubject: count,
    batchActivities: count,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection(QUEUE_COLLECTION).doc(runRef.id).set({
    familyId,
    runId: runRef.id,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { runId: runRef.id, totalSubjects: subjectsSnap.size, matchingSubjects, status: "queued", done: false };
}

function summarizeSubjects(subjects) {
  const values = Object.values(subjects || {});
  return {
    completedSubjects: values.filter((s) => s.status === "done").length,
    totalActivities: values.reduce((sum, s) => sum + Number(s.activityCount || 0), 0),
  };
}

export async function continueSyllabusRun({
  db, familyId, runId, uid, role, llm, genConfig, contentLlm, contentGenConfig, subjectLimit = 1,
}) {
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists) throw new HttpsError("not-found", "Syllabus run not found.");
  const run = runSnap.data();
  if (run.type !== "syllabus") throw new HttpsError("failed-precondition", "This is not a syllabus run.");
  if (run.uid && run.uid !== uid && !["owner", "parent", "superadmin"].includes(role)) {
    throw new HttpsError("permission-denied", "You cannot continue this syllabus run.");
  }
  if (run.status === "done") return { configured: true, runId, done: true, ...summarizeSubjects(run.subjects) };
  // The parent hit "Stop": don't begin any more subjects. Mark the queue row
  // terminal so the worker stops re-claiming it.
  if (run.status === "cancelled") {
    await db.collection(QUEUE_COLLECTION).doc(runId).set(
      { familyId, runId, status: "cancelled", updatedAt: new Date() }, { merge: true }
    );
    return { configured: true, runId, done: true, cancelled: true, ...summarizeSubjects(run.subjects) };
  }

  const curriculumId = run.curriculumId;
  const subjectsSnap = await db
    .collection("families").doc(familyId)
    .collection("curriculum").doc(curriculumId)
    .collection("subjects").get();
  if (subjectsSnap.empty) throw new Error("No subjects found in this curriculum â€” add subjects first.");

  let subjects = { ...(run.subjects || {}) };
  let processed = 0;
  const targetActivitiesPerSubject = Math.max(1, Number(run.targetActivitiesPerSubject) || DEFAULT_ACTIVITIES_PER_SUBJECT);
  const batchActivities = Math.max(1, Number(run.batchActivities) || DEFAULT_BATCH_ACTIVITIES);
  const onlyTypes = Array.isArray(run.onlyTypes) ? run.onlyTypes : [];
  const guidance = clampGuidance(run.guidance);

  // Process each subject sequentially, updating progress after each.
  for (const subjectDoc of subjectsSnap.docs) {
    const subjectId = subjectDoc.id;
    const subjectState = subjects[subjectId] || {};
    const subjectTarget = Math.max(1, Number(subjectState.targetActivityCount) || targetActivitiesPerSubject);
    if (isSubjectTerminal(subjectState) || Number(subjectState.activityCount || 0) >= subjectTarget) continue;
    if (processed >= subjectLimit) break;

    // Mark this subject as running. Use update() so dot-notation resolves
    // as nested field paths (set+merge treats them as literal key names).
    await runRef.update({
      status: "running",
      currentSubjectId: subjectId,
      [`subjects.${subjectId}.status`]: "running",
      updatedAt: new Date(),
    });
    subjects[subjectId] = { ...(subjects[subjectId] || {}), status: "running" };

    try {
      const { totalSubjectActivities } = await runSyllabusWorker({
        db, familyId, curriculumId, subjectId, uid, role, llm, genConfig, contentLlm, contentGenConfig,
        targetActivitiesPerSubject: subjectTarget,
        batchActivities,
        onlyTypes,
        guidance,
      });
      const subjectDone = totalSubjectActivities >= subjectTarget;
      subjects[subjectId] = {
        ...(subjects[subjectId] || {}),
        status: subjectDone ? "done" : "queued",
        activityCount: totalSubjectActivities,
        targetActivityCount: subjectTarget,
        error: "",
      };
      const summary = summarizeSubjects(subjects);
      await runRef.update({
        [`subjects.${subjectId}.status`]: subjectDone ? "done" : "queued",
        [`subjects.${subjectId}.activityCount`]: totalSubjectActivities,
        [`subjects.${subjectId}.targetActivityCount`]: subjectTarget,
        [`subjects.${subjectId}.error`]: "",
        completedSubjects: summary.completedSubjects,
        totalActivities: summary.totalActivities,
        status: "queued",
        currentSubjectId: null,
        updatedAt: new Date(),
      });
    } catch (e) {
      // Bounded retry: count attempts and only give up (terminal "failed") after
      if (["resource-exhausted", "permission-denied", "failed-precondition", "unavailable"].includes(e?.code)) throw e;
      // MAX_SUBJECT_ATTEMPTS, so a persistently-failing subject can't loop the run
      // forever (audit #3) while a transient blip still gets retried.
      const attempts = Number(subjects[subjectId]?.attempts || 0) + 1;
      const failed = attempts >= MAX_SUBJECT_ATTEMPTS;
      const nextStatus = failed ? "failed" : "error";
      console.warn(`[syllabus] subject ${subjectId} attempt ${attempts}/${MAX_SUBJECT_ATTEMPTS} failed: ${e.message}`);
      subjects[subjectId] = {
        ...(subjects[subjectId] || {}),
        status: nextStatus,
        attempts,
        error: e.message,
      };
      const summary = summarizeSubjects(subjects);
      await runRef.update({
        [`subjects.${subjectId}.status`]: nextStatus,
        [`subjects.${subjectId}.attempts`]: attempts,
        [`subjects.${subjectId}.error`]: e.message,
        completedSubjects: summary.completedSubjects,
        totalActivities: summary.totalActivities,
        // Keep the run actionable: a retryable error re-queues; a terminal failure
        // lets the remaining subjects finish. The run only halts when everything
        // is terminal (handled by the `done` computation below).
        status: "queued",
        currentSubjectId: null,
        updatedAt: new Date(),
      });
    }
    processed += 1;
  }

  // A cancel may have landed while this subject was being generated. Re-read the
  // run status before the final queue write so we don't resurrect a stopped run by
  // re-queuing it.
  const freshStatus = (await runRef.get()).data()?.status;
  if (freshStatus === "cancelled") {
    await db.collection(QUEUE_COLLECTION).doc(runId).set(
      { familyId, runId, status: "cancelled", updatedAt: new Date() }, { merge: true }
    );
    return { configured: true, runId, done: true, cancelled: true, ...summarizeSubjects(subjects) };
  }

  const summary = summarizeSubjects(subjects);
  // Done when every subject is terminal (completed OR permanently failed) — not
  // only when all completed, so a failed subject can't block completion (audit #3).
  const done = Object.values(subjects).every(isSubjectTerminal) &&
    Object.keys(subjects).length >= subjectsSnap.size;
  if (done) {
    await runRef.update({
      status: "done",
      totalActivities: summary.totalActivities,
      completedSubjects: summary.completedSubjects,
      currentSubjectId: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection(QUEUE_COLLECTION).doc(runId).set({
      familyId,
      runId,
      status: "done",
      updatedAt: new Date(),
      finishedAt: new Date(),
    }, { merge: true });

    // Refresh the single-source-of-truth brief now the syllabus exists.
    await regenerateBriefSafe(db, familyId);
  } else {
    await db.collection(QUEUE_COLLECTION).doc(runId).set({
      familyId,
      runId,
      status: "queued",
      updatedAt: new Date(),
    }, { merge: true });
  }

  return {
    configured: true,
    runId,
    done,
    processed,
    totalSubjects: subjectsSnap.size,
    ...summary,
  };
}

export async function runSyllabus({
  db, familyId, curriculumId, uid, role, llm, genConfig, contentLlm, contentGenConfig,
  targetActivitiesPerSubject = DEFAULT_ACTIVITIES_PER_SUBJECT,
}) {
  const { runId } = await startSyllabusRun({ db, familyId, curriculumId, uid, role, targetActivitiesPerSubject });
  let result;
  do {
    result = await continueSyllabusRun({
      db, familyId, runId, uid, role, llm, genConfig, contentLlm, contentGenConfig, subjectLimit: 1,
    });
  } while (!result.done);
  return { runId, totalActivities: result.totalActivities, completedSubjects: result.completedSubjects };
}

export async function runSyllabusQueuePass({ db, limit = 2 } = {}) {
  const queuedSnap = await db.collection(QUEUE_COLLECTION)
    .where("status", "==", "queued")
    .limit(limit)
    .get();
  if (queuedSnap.empty) return { processed: 0 };

  const { llm, genConfig } = await resolveLlm(db, "syllabus", providerKeys());
  const { llm: contentLlm, genConfig: contentGenConfig } = await resolveLlm(db, "content", providerKeys());
  if (!llm) {
    for (const q of queuedSnap.docs) {
      await q.ref.set({
        status: "error",
        error: "The syllabus agent is not configured.",
        updatedAt: new Date(),
      }, { merge: true });
    }
    return { processed: 0, configured: false };
  }

  let processed = 0;
  for (const q of queuedSnap.docs) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(q.ref);
      if (!fresh.exists || fresh.data().status !== "queued") return null;
      tx.set(q.ref, { status: "running", claimedAt: new Date(), updatedAt: new Date() }, { merge: true });
      return fresh.data();
    });
    if (!claimed) continue;

    try {
      const runSnap = await db
        .collection("families").doc(claimed.familyId)
        .collection("agentRuns").doc(claimed.runId).get();
      if (!runSnap.exists) {
        await q.ref.set({ status: "error", error: "Syllabus run not found.", updatedAt: new Date() }, { merge: true });
        continue;
      }
      const run = runSnap.data();
      // Skip a run the parent stopped — leave the queue row cancelled.
      if (run.status === "cancelled") {
        await q.ref.set({ status: "cancelled", updatedAt: new Date() }, { merge: true });
        continue;
      }
      // Per-family metered clients so each run's cost is attributed to its family
      // (the pass-level clients above are family-agnostic).
      const runUid = run.uid || claimed.uid || "system";
      const runId = claimed.runId;
      const { llm: famLlm, genConfig: famGenConfig } =
        await resolveLlm(db, "syllabus", providerKeys(), { familyId: claimed.familyId, uid: runUid, runId, source: "syllabusWorker" });
      const { llm: famContentLlm, genConfig: famContentGenConfig } =
        await resolveLlm(db, "content", providerKeys(), { familyId: claimed.familyId, uid: runUid, runId, source: "syllabusWorker" });
      // "Generate more activities" (type top-up) should feel noticeably more
      // creative than a standard syllabus build — floor the temperature rather
      // than offsetting it, so this holds even if the base syllabus temperature
      // is tuned down later.
      const baseGenConfig = famGenConfig || genConfig;
      const runGenConfig = run.mode === "topup"
        ? { ...baseGenConfig, temperature: Math.max(0.65, Number(baseGenConfig?.temperature) || 0.4) }
        : baseGenConfig;
      await continueSyllabusRun({
        db,
        familyId: claimed.familyId,
        runId: claimed.runId,
        uid: runUid,
        role: run.role || "owner",
        llm: famLlm || llm,
        genConfig: runGenConfig,
        contentLlm: famContentLlm || contentLlm,
        contentGenConfig: famContentGenConfig || contentGenConfig,
        subjectLimit: 1,
      });
      processed += 1;
    } catch (e) {
      if (["resource-exhausted", "permission-denied", "failed-precondition"].includes(e?.code)) {
        await db.collection("families").doc(claimed.familyId).collection("agentRuns").doc(claimed.runId).set({ status: "error", error: String(e?.message || e).slice(0, 500), updatedAt: new Date() }, { merge: true });
      }
      await q.ref.set({
        status: ["resource-exhausted", "permission-denied", "failed-precondition"].includes(e?.code) ? "error" : "queued",
        lastError: String(e?.message || e).slice(0, 500),
        updatedAt: new Date(),
      }, { merge: true });
    }
  }

  return { processed, configured: true };
}

export const syllabusWorker = onSchedule(
  { schedule: "every 1 minutes", timeoutSeconds: 540, secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], maxInstances: 1 },
  async () => {
    await runSyllabusQueuePass({ db: getFirestore(), limit: 2 });
  }
);

// ─── Callable ─────────────────────────────────────────────────────────────────
export const generateSyllabus = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    const runId = String(request.data?.runId || "").trim();
    const curriculumId = String(request.data?.curriculumId || "").trim();
    if (!runId && !curriculumId) throw new HttpsError("invalid-argument", "curriculumId or runId is required.");

    const { llm, provider } = await resolveLlm(db, "syllabus", providerKeys(), { familyId, uid, runId, source: "generateSyllabus" });
    if (!llm) {
      return {
        configured: false,
        text: `The syllabus agent isn't configured yet — set the ${secretNameForProvider(provider)} secret to enable it.`,
      };
    }
    if (!runId) {
      // Only count when STARTING a new build (polling via runId is free). (audit #12)
      await enforceDailyLimit(db, familyId, "syllabus");
      const targetActivitiesPerSubject = Math.min(120, Math.max(4, Number(request.data?.targetActivitiesPerSubject) || DEFAULT_ACTIVITIES_PER_SUBJECT));
      const allowance = await consumePlanUsage(db, familyId, "activities", { uid, dryRun: true });
      const activityBudget = Math.min(allowance.remaining, allowance.dailyRemaining);
      if (!activityBudget) throw new HttpsError("resource-exhausted", "Your prepared activity allowance is used. Saved activities remain available.");
      const started = await startSyllabusRun({ db, familyId, curriculumId, uid, role, targetActivitiesPerSubject, activityBudget });
      return { configured: true, ...started };
    }

    const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc(runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) throw new HttpsError("not-found", "Syllabus run not found.");
    const run = runSnap.data();
    // Never resurrect a run the parent explicitly stopped.
    if (run.status !== "done" && run.status !== "running" && run.status !== "cancelled") {
      await runRef.set({ status: "queued", updatedAt: new Date() }, { merge: true });
      await db.collection(QUEUE_COLLECTION).doc(runId).set({
        familyId,
        runId,
        status: "queued",
        updatedAt: new Date(),
      }, { merge: true });
    }
    return { configured: true, runId, status: run.status, done: run.status === "done" };
  }
);

// Callable — "Generate more activities": create brand-new activities of the
// selected type(s), scoped to subjects that already have that type. Rides the
// same agentRuns/syllabusQueue/syllabusWorker machinery as generateSyllabus
// (see startActivityTopUp), so progress/resume/stop all work identically.
export const requestActivityTopUp = onCall(
  { secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    const runId = String(request.data?.runId || "").trim();
    const curriculumId = String(request.data?.curriculumId || "").trim();
    if (!runId && !curriculumId) throw new HttpsError("invalid-argument", "curriculumId or runId is required.");

    const { llm, provider } = await resolveLlm(db, "syllabus", providerKeys(), { familyId, uid, runId, source: "requestActivityTopUp" });
    if (!llm) {
      return {
        configured: false,
        text: `The syllabus agent isn't configured yet — set the ${secretNameForProvider(provider)} secret to enable it.`,
      };
    }
    if (!runId) {
      // Only count when STARTING a new top-up (polling via runId is free), same
      // bucket as syllabus generation since it's the same cost class.
      await enforceDailyLimit(db, familyId, "syllabus");
      const onlyTypes = Array.isArray(request.data?.onlyTypes) ? request.data.onlyTypes.map((t) => String(t || "").trim()) : [];
      const onlySubjects = Array.isArray(request.data?.onlySubjects) ? request.data.onlySubjects.map((s) => String(s || "").trim()) : [];
      const addCount = Math.min(12, Math.max(1, Number(request.data?.addCount) || DEFAULT_BATCH_ACTIVITIES));
      const guidance = clampGuidance(request.data?.guidance);
      const allowance = await consumePlanUsage(db, familyId, "activities", { uid, dryRun: true });
      const started = await startActivityTopUp({ db, familyId, curriculumId, uid, role, onlyTypes, onlySubjects, addCount, guidance, activityBudget: Math.min(allowance.remaining, allowance.dailyRemaining) });
      return { configured: true, ...started };
    }

    const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc(runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) throw new HttpsError("not-found", "Activity top-up run not found.");
    const run = runSnap.data();
    if (run.mode !== "topup") throw new HttpsError("failed-precondition", "This is not a top-up run.");
    // Never resurrect a run the parent explicitly stopped.
    if (run.status !== "done" && run.status !== "running" && run.status !== "cancelled") {
      await runRef.set({ status: "queued", updatedAt: new Date() }, { merge: true });
      await db.collection(QUEUE_COLLECTION).doc(runId).set({
        familyId,
        runId,
        status: "queued",
        updatedAt: new Date(),
      }, { merge: true });
    }
    return { configured: true, runId, status: run.status, done: run.status === "done" };
  }
);

// Callable — make sure the default subject catalog (Geography, Social Studies,
// History, Politics) exists in a curriculum. Idempotent and side-effect-free
// beyond the seeded docs: seeded defaults stay dormant until the parent
// explicitly generates activities for them. The Syllabus view calls this on
// load so the subjects — and the by-subject top-up chips — always list them.
export const ensureDefaultSubjects = onCall({ timeoutSeconds: 30 }, async (request) => {
  const { db, familyId } = await resolveCaller(request);
  const curriculumId = String(request.data?.curriculumId || "").trim();
  if (!curriculumId) throw new HttpsError("invalid-argument", "curriculumId is required.");
  const result = await ensureDefaultSubjectDocs({ db, familyId, curriculumId });
  return { configured: true, ...result };
});

// Mark a syllabus run cancelled. The worker re-checks the run status and stops
// re-claiming the queue row; an in-flight subject finishes, then it halts.
// Exported (pure) for unit testing.
export async function cancelSyllabusRun({ db, familyId, runId, uid }) {
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc(runId);
  const snap = await runRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Syllabus run not found.");
  await runRef.set(
    { status: "cancelled", cancelledAt: new Date(), cancelledBy: uid || "system", updatedAt: new Date() },
    { merge: true }
  );
  await db.collection(QUEUE_COLLECTION).doc(runId).set(
    { familyId, runId, status: "cancelled", updatedAt: new Date() }, { merge: true }
  );
  return { ok: true, status: "cancelled" };
}

// Callable — the parent's "Stop" button on the syllabus builder. Owner/parent only.
export const stopSyllabus = onCall({ timeoutSeconds: 30 }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can stop syllabus generation.");
  }
  const runId = String(request.data?.runId || "").trim();
  if (!runId) throw new HttpsError("invalid-argument", "runId is required.");
  return cancelSyllabusRun({ db, familyId, runId, uid });
});
