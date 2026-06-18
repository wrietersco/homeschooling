// Guide agent — an interactive, READ-ONLY assistant that helps a family member
// explore their own data and stats. It cannot mutate anything (read-only tool
// set). Each run is persisted to agentRuns/{runId} for the audit trail and the
// exchange is mirrored into the intercom chat log.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { resolveCaller } from "../lib/caller.js";
import { buildGroundedSystemPrompt } from "./grounding.js";
import { createTools, filterDeclarations, READ_ONLY_TOOL_NAMES } from "./tools.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";

const GUIDE_BASE_PROMPT = [
  "You are the family's homeschooling guide.",
  "Answer questions about THIS family's children, skills, curriculum, activities,",
  "scores, and observations using the tools. Be warm, concise, and practical.",
  "You are read-only: never claim to have changed data. If asked to change",
  "something, explain where in the app they can do it.",
].join(" ");

// Core (exported for integration tests that pass their own db/llm).
export async function runGuide({ db, familyId, uid, role, message, history = [], llm, genConfig }) {
  const system = await buildGroundedSystemPrompt(db, familyId, GUIDE_BASE_PROMPT, "guide");
  const run = { type: "guide", uid, status: "running", audit: [], createdAt: FieldValue.serverTimestamp() };
  const runRef = db.collection("families").doc(familyId).collection("agentRuns").doc();
  await runRef.set(run);

  const { impls } = createTools({ db, familyId, uid, role, mode: "read", run });
  const result = await runAgent({
    llm,
    system,
    toolDeclarations: filterDeclarations(READ_ONLY_TOOL_NAMES),
    tools: impls,
    userMessage: message,
    history,
    maxSteps: 6,
    generationConfig: genConfig,
  });

  await runRef.set(
    {
      status: "done",
      stoppedAt: result.stoppedAt,
      steps: result.steps.map((s) => ({ tool: s.tool, args: s.args })),
      answer: result.text,
      finishedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { text: result.text, runId: runRef.id, steps: result.steps };
}

export const askGuide = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  const message = String(request.data?.message || "").trim().slice(0, 4000);
  if (!message) throw new HttpsError("invalid-argument", "Ask a question.");

  const { llm, genConfig } = await resolveLlm(db, "guide", process.env.GEMINI_API_KEY);
  if (!llm) {
    return {
      text: "The AI guide isn't configured yet — set the GEMINI_API_KEY secret to enable it.",
      configured: false,
    };
  }

  // Persist the user's message to intercom for history continuity.
  const intercom = db.collection("families").doc(familyId).collection("intercom");
  await intercom.add({ role: "user", uid, text: message, at: FieldValue.serverTimestamp() });

  const { text, runId } = await runGuide({ db, familyId, uid, role, message, llm, genConfig });

  await intercom.add({ role: "assistant", text, runId, at: FieldValue.serverTimestamp() });
  return { text, runId, configured: true };
});
