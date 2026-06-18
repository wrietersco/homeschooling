// Curriculum agent — goal-based interactive chat that interviews parents,
// weights the family's guiding light heavily, then generates and persists a
// 6-month curriculum plan (objectives / content / instruction / assessment).
// Uses read tools for discovery + one purpose-built finalize_curriculum tool
// that batch-writes the curriculum doc + subjects subcollection.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { buildGroundedSystemPrompt } from "./grounding.js";
import { createTools, filterDeclarations, READ_ONLY_TOOL_NAMES } from "./tools.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";

const CURRICULUM_BASE_PROMPT = [
  "You are the Dar-al-Hikmah curriculum architect for this family.",
  "",
  "YOUR GOAL: Create a comprehensive 6-month homeschooling curriculum plan grounded in",
  "THIS family's guiding light and context. The guiding light is the PRIMARY filter —",
  "not decoration but the living core of every subject, approach, and assessment.",
  "",
  "PROCESS (follow this order):",
  "1. GREET & INTERVIEW: Ask 2-3 focused questions about: which subjects to cover,",
  "   children's current levels/grade equivalence, and teaching approach preferences.",
  "   Ask at most 3 questions per turn. Be warm and concise.",
  "2. READ DATA: Use list_collections + query_collection to read the children's profiles,",
  "   existing skills, and any prior curriculum before generating.",
  "3. GENERATE: After at least one full parent exchange and reading the data, call",
  "   finalize_curriculum ONCE with ALL subjects in a single call. Pass the plan ONLY",
  "   as the tool's arguments — do NOT also write the curriculum content out as a chat",
  "   message. Writing the plan as prose AND calling the tool in the same turn wastes",
  "   the output budget and can truncate the tool call. Just call the tool.",
  "4. CONFIRM: After finalize_curriculum returns success, summarize what was created in",
  "   1-2 sentences.",
  "",
  "CURRICULUM QUALITY STANDARDS:",
  "- Every subject goal and teaching approach must explicitly reflect the guiding light.",
  "- Per subject: macroGoals (3-5 overarching competencies for 6 months),",
  "  contentOutline (month-by-month or topic progression), instructionApproach",
  "  (pedagogy and how it is taught), assessmentMethod (completion-focused, NEVER",
  "  ranking children against each other), gradingStandards (what completion looks like),",
  "  targetChildren (child IDs from the family data).",
  "- Keep scope realistic: 4-7 subjects for 6 months.",
  "- Note co-op opportunities (siblings learning together) explicitly.",
  "",
  "IMPORTANT: Do not call finalize_curriculum until you know: (a) which subjects to cover,",
  "(b) approximate levels for each child, and (c) the family's teaching preferences.",
].join("\n");

// Tool declaration for the purpose-built curriculum-write action.
const FINALIZE_DECLARATION = {
  name: "finalize_curriculum",
  description:
    "Write the final 6-month curriculum plan to Firestore. Call this ONLY after you have gathered enough information from the parents through the interview. Creates the curriculum document and all subject sub-documents in one atomic batch.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, memorable title for this curriculum plan.",
      },
      objectives: {
        type: "string",
        description: "Overall 6-month objectives — 3-5 sentences summarizing the full arc.",
      },
      subjects: {
        type: "array",
        description: "One entry per subject.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            macroGoals: {
              type: "array",
              items: { type: "string" },
              description: "3-5 overarching competencies to develop over 6 months.",
            },
            contentOutline: {
              type: "string",
              description: "Month-by-month or topic-by-topic content progression.",
            },
            instructionApproach: {
              type: "string",
              description: "Pedagogy and teaching method for this subject.",
            },
            assessmentMethod: {
              type: "string",
              description: "How progress is measured — completion-focused, never inter-child ranking.",
            },
            gradingStandards: {
              type: "string",
              description: "What 'done well' looks like for this subject.",
            },
            targetChildren: {
              type: "array",
              items: { type: "string" },
              description: "Child IDs from the family (from query_collection children results).",
            },
          },
          required: ["name", "macroGoals", "contentOutline", "instructionApproach", "assessmentMethod"],
        },
      },
      guidingLightSnapshot: {
        type: "string",
        description:
          "Copy the family guiding light exactly as stated in the system context. This is stored as the seed that shaped this plan.",
      },
    },
    required: ["title", "objectives", "subjects", "guidingLightSnapshot"],
  },
};

// Core — exported so integration tests can inject a fake LLM and db.
export async function runCurriculum({ db, familyId, uid, role, message, history = [], llm, genConfig }) {
  const system = await buildGroundedSystemPrompt(db, familyId, CURRICULUM_BASE_PROMPT, "curriculum");
  const run = { type: "curriculum", uid, status: "running", audit: [] };
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc();
  await runRef.set({ ...run, createdAt: new Date() });

  const { impls: readImpls } = createTools({ db, familyId, uid, role, mode: "read", run });
  let curriculumCreated = null;

  const tools = {
    ...readImpls,
    async finalize_curriculum({ title, objectives, subjects, guidingLightSnapshot }) {
      const root = db.collection("families").doc(familyId);
      const batch = db.batch();
      const currRef = root.collection("curriculum").doc();
      batch.set(currRef, {
        title,
        objectives,
        guidingLightSnapshot,
        status: "active",
        subjectCount: (subjects || []).length,
        createdAt: new Date(),
        createdBy: uid,
      });
      for (const s of subjects || []) {
        const sRef = currRef.collection("subjects").doc();
        batch.set(sRef, { ...s, createdAt: new Date() });
      }
      await batch.commit();
      curriculumCreated = { id: currRef.id, title, subjectCount: (subjects || []).length };
      run.audit.push({ action: "create", collection: "curriculum", id: currRef.id, at: new Date().toISOString(), uid });
      return { success: true, curriculumId: currRef.id, subjectCount: (subjects || []).length };
    },
  };

  const declarations = [...filterDeclarations(READ_ONLY_TOOL_NAMES), FINALIZE_DECLARATION];

  const result = await runAgent({
    llm,
    system,
    toolDeclarations: declarations,
    tools,
    userMessage: message,
    history,
    maxSteps: 12,
    // The finalize_curriculum call serializes a full 6-month plan (4-7 subjects,
    // each with multi-sentence content + goal arrays). The default 2048-token
    // ceiling truncates that call mid-emission — Gemini drops it with
    // finishReason MAX_TOKENS, so it never reaches the tool. Give it real room
    // (the 'curriculum' agent default is 8192; superadmin can raise it further).
    generationConfig: genConfig ?? { maxOutputTokens: 8192 },
  });

  await runRef.set(
    {
      status: "done",
      stoppedAt: result.stoppedAt,
      steps: result.steps.map((s) => ({ tool: s.tool, args: s.args })),
      answer: result.text,
      curriculumId: curriculumCreated?.id || null,
      finishedAt: new Date(),
    },
    { merge: true }
  );

  return { text: result.text, runId: runRef.id, steps: result.steps, curriculum: curriculumCreated };
}

export const askCurriculum = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  const message = String(request.data?.message || "").trim().slice(0, 4000);
  if (!message) throw new HttpsError("invalid-argument", "Send a message to the curriculum agent.");
  const history = Array.isArray(request.data?.history) ? request.data.history : [];

  const { llm, genConfig } = await resolveLlm(db, "curriculum", process.env.GEMINI_API_KEY);
  if (!llm) {
    return {
      text: "The curriculum agent isn't configured yet — set the GEMINI_API_KEY secret to enable it.",
      configured: false,
    };
  }

  const { text, runId, curriculum } = await runCurriculum({
    db, familyId, uid, role, message, history, llm, genConfig,
  });

  return { text, runId, configured: true, curriculum: curriculum || null };
});
