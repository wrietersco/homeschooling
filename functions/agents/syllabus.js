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
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";
import { loadPlatformInstructions, describeGuardian } from "./grounding.js";
import { generateContentForActivity } from "./activityContent.js";

// ─── Activity type enum ───────────────────────────────────────────────────────
const ACTIVITY_TYPES = [
  "quran", "noorani_qaida", "story_reading", "mathematics",
  "computer", "ai_robotics", "physical", "teaching",
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
        description: "Step-by-step instructions for the parent. Be concrete and actionable.",
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
function buildWorkerSystemPrompt({ subjectName, macroGoals, contentOutline, instructionApproach, assessmentMethod, children, guardians, guidingLight, platformInstructions, existingTitles }) {
  const lines = [
    platformInstructions || "",
    platformInstructions ? "" : "",
    `You are generating a 6-month activity syllabus for the subject: **${subjectName}**.`,
    "",
    "FAMILY CONTEXT:",
    `Guiding light: ${guidingLight || "(not set)"} — every activity must visibly reflect this.`,
    guardians && guardians.length ? `Guardians (parents/teachers):\n${guardians.join("\n")}` : "",
    `Children: ${children.map((c) => `${c.name || c.id}${c.dob ? ` (dob ${c.dob})` : ""}`).join("; ") || "(none)"}`,
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
    "YOUR TASK: Call create_activity exactly 4-6 times.",
    "  Rank 1 — introductory: first 2 weeks, minimal prerequisites.",
    "  Rank 2 — basic: consolidation, builds on rank 1.",
    "  Rank 3 — intermediate: mid-term, stretches capability.",
    "  Rank 4 — advanced: near end, deeper engagement.",
    "  Rank 5 — mastery/synthesis: final 2 weeks, everything comes together.",
    "Each activity must align with the guiding light and be practical for a home setting.",
    "Assessment is always completion-focused — never compare children to each other.",
  ];
  return lines.filter(Boolean).join("\n");
}

// ─── Per-subject worker (exported for integration tests) ──────────────────────
export async function runSyllabusWorker({
  db, familyId, curriculumId, subjectId, uid, llm, genConfig, contentLlm, contentGenConfig,
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

  // Load any existing activities for this subject to avoid duplication.
  const existingSnap = await db
    .collection("families").doc(familyId)
    .collection("activities")
    .where("subjectId", "==", subjectId).limit(30).get();
  const existingTitles = existingSnap.docs.map((d) => d.data().title).filter(Boolean);

  const activitiesCreated = [];
  const activitiesRef = db.collection("families").doc(familyId).collection("activities");

  // Tool: create_activity — writes directly to Firestore.
  const tools = {
    async create_activity({ title, type, complexityRank, coopMode, targetChildren, parentInstructions, exampleWalkthrough, durationMinutes }) {
      const resolvedType = ACTIVITY_TYPES.includes(type) ? type : "teaching";
      const activityDoc = {
        title: String(title || "Untitled"),
        type: resolvedType,
        subject: subject.name || subjectId,
        subjectId,
        curriculumId,
        complexityRank: Math.min(5, Math.max(1, Number(complexityRank) || 1)),
        coopMode: Boolean(coopMode),
        targetChildren: Array.isArray(targetChildren) && targetChildren.length
          ? targetChildren
          : children.map((c) => c.id),
        parentInstructions: String(parentInstructions || ""),
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
      // never block activity creation.
      if (contentLlm) {
        try {
          const { kind, content } = await generateContentForActivity({
            activity: activityDoc, children, guardians, guidingLight,
            llm: contentLlm,
            genConfig: contentGenConfig,
            geminiApiKey: process.env.GEMINI_API_KEY || "",
            storagePrefix: familyId,
          });
          if (content) {
            activityDoc.content = content;
            activityDoc.contentGeneratedAt = new Date();
          } else {
            activityDoc.contentKind = kind; // record intended kind even if generation came back empty
          }
        } catch (e) {
          activityDoc.contentError = String(e?.message || e).slice(0, 300);
        }
      }

      const ref = await activitiesRef.add(activityDoc);
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
    platformInstructions,
    existingTitles,
  });

  const result = await runAgent({
    llm,
    system,
    toolDeclarations: [CREATE_ACTIVITY_DECLARATION],
    tools,
    userMessage: `Generate the complete activity series for "${subject.name || subjectId}" now. Call create_activity 4-6 times, progressing from complexity rank 1 (introductory) to rank 5 (mastery).`,
    maxSteps: 14,
    generationConfig: genConfig,
  });

  return { text: result.text, activitiesCreated, subjectName: subject.name };
}

// ─── Master runner (exported for integration tests) ───────────────────────────
export async function runSyllabus({ db, familyId, curriculumId, uid, role, llm, genConfig, contentLlm, contentGenConfig }) {
  // Load subjects from the curriculum.
  const subjectsSnap = await db
    .collection("families").doc(familyId)
    .collection("curriculum").doc(curriculumId)
    .collection("subjects").get();
  if (subjectsSnap.empty) throw new Error("No subjects found in this curriculum — add subjects first.");

  // Build the initial subjects map for the progress doc.
  const subjectsMap = {};
  for (const d of subjectsSnap.docs) {
    subjectsMap[d.id] = { name: d.data().name || d.id, status: "pending", activityCount: 0 };
  }

  // Create the agent-run progress doc.
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc();
  await runRef.set({
    type: "syllabus",
    uid,
    curriculumId,
    status: "running",
    subjects: subjectsMap,
    totalSubjects: subjectsSnap.size,
    completedSubjects: 0,
    totalActivities: 0,
    createdAt: new Date(),
  });

  let totalActivities = 0;
  let completedSubjects = 0;

  // Process each subject sequentially, updating progress after each.
  for (const subjectDoc of subjectsSnap.docs) {
    const subjectId = subjectDoc.id;

    // Mark this subject as running. Use update() so dot-notation resolves
    // as nested field paths (set+merge treats them as literal key names).
    await runRef.update({ [`subjects.${subjectId}.status`]: "running" });

    try {
      const { activitiesCreated } = await runSyllabusWorker({
        db, familyId, curriculumId, subjectId, uid, role, llm, genConfig, contentLlm, contentGenConfig,
      });
      totalActivities += activitiesCreated.length;
      completedSubjects++;
      await runRef.update({
        [`subjects.${subjectId}.status`]: "done",
        [`subjects.${subjectId}.activityCount`]: activitiesCreated.length,
        completedSubjects,
        totalActivities,
      });
    } catch (e) {
      await runRef.update({
        [`subjects.${subjectId}.status`]: "error",
        [`subjects.${subjectId}.error`]: e.message,
        completedSubjects,
      });
    }
  }

  await runRef.update({ status: "done", totalActivities, completedSubjects, finishedAt: new Date() });

  return { runId: runRef.id, totalActivities, completedSubjects };
}

// ─── Callable ─────────────────────────────────────────────────────────────────
export const generateSyllabus = onCall(
  { secrets: ["GEMINI_API_KEY", "QURAN_CLIENT_ID", "QURAN_CLIENT_SECRET"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    const curriculumId = String(request.data?.curriculumId || "").trim();
    if (!curriculumId) throw new HttpsError("invalid-argument", "curriculumId is required.");

    const { llm, genConfig } = await resolveLlm(db, "syllabus", process.env.GEMINI_API_KEY);
    if (!llm) {
      return {
        configured: false,
        text: "The syllabus agent isn't configured yet — set the GEMINI_API_KEY secret to enable it.",
      };
    }
    // Inline activity-content generation runs on the 'content' agent runtime.
    const { llm: contentLlm, genConfig: contentGenConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY);

    const { runId, totalActivities, completedSubjects } = await runSyllabus({
      db, familyId, curriculumId, uid, role, llm, genConfig, contentLlm, contentGenConfig,
    });

    return { configured: true, runId, totalActivities, completedSubjects };
  }
);
