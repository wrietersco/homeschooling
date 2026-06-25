// Guide agent — an interactive, READ-ONLY assistant that helps a family member
// explore their own data and stats. It cannot mutate anything (read-only tool
// set). It is omniscient over THIS family's data (via the grounded prompt),
// knows exactly which guardian it is talking to right now, and keeps a per-
// guardian chat session so it remembers what that person has been asking.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";
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

// How many prior messages of this guardian's thread to replay as context.
const HISTORY_LIMIT = 16;

// Format the "who am I talking to" block from the resolved member + guardian
// records. Pure (no DB) so it is unit-testable. Returns "" when nothing is known.
export function formatCurrentUser({ member = {}, guardian = null } = {}) {
  const name = guardian?.name || member.displayName || member.email || "this guardian";
  const bits = [];
  if (guardian?.relationship) bits.push(guardian.relationship);
  if (member.role) bits.push(`${member.role} account`);
  if (member.email) bits.push(member.email);
  if (guardian?.motherTongue) bits.push(`mother tongue ${guardian.motherTongue}`);
  const detail = bits.length ? ` (${bits.join(", ")})` : "";
  return [
    "CURRENT USER — you are speaking RIGHT NOW with this specific guardian:",
    `${name}${detail}.`,
    "Address them by name, warmly and personally. Tailor your guidance to them —",
    "their availability, their mother tongue, and the children they look after.",
    "You are mid-conversation: remember what they asked earlier in this chat and",
    "build on it rather than restarting.",
  ].join("\n");
}

// Convert stored chat docs ({ role: 'user'|'assistant', text }) into the Gemini
// `contents` history shape. Drops empties and maps assistant→model. Pure.
export function historyToContents(docs = []) {
  return docs
    .filter((m) => m && m.text)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.text) }],
    }));
}

// Read the last HISTORY_LIMIT messages of this guardian's thread, oldest-first,
// as Gemini history. Best-effort: an empty history never blocks a new question.
async function loadHistory(messagesRef) {
  try {
    const snap = await messagesRef.orderBy("at", "desc").limit(HISTORY_LIMIT).get();
    return historyToContents(snap.docs.map((d) => d.data()).reverse());
  } catch (e) {
    console.warn(`[guide] loadHistory failed: ${e?.message || e}`);
    return [];
  }
}

// Resolve a short description of the signed-in guardian: their member record
// plus the guardian profile bound to their account (guardians.memberUid == uid).
async function describeCurrentUser(db, familyId, uid) {
  try {
    const p = familyPaths(db, familyId);
    const [memberSnap, guardianSnap] = await Promise.all([
      p.member(uid).get(),
      p.guardians().where("memberUid", "==", uid).limit(1).get(),
    ]);
    return formatCurrentUser({
      member: memberSnap.exists ? memberSnap.data() : {},
      guardian: guardianSnap.docs[0]?.data() || null,
    });
  } catch (e) {
    console.warn(`[guide] describeCurrentUser(${uid}) failed: ${e?.message || e}`);
    return "";
  }
}

// Core (exported for integration tests that pass their own db/llm). `context` is
// an optional hint about what the guardian is currently looking at in the app
// (e.g. the activity open on the player page) so guidance can be in-the-moment.
export async function runGuide({ db, familyId, uid, role, message, history = [], context = "", llm, genConfig }) {
  const [grounded, whoAmI] = await Promise.all([
    buildGroundedSystemPrompt(db, familyId, GUIDE_BASE_PROMPT, "guide"),
    describeCurrentUser(db, familyId, uid),
  ]);
  const sections = [grounded];
  if (whoAmI) sections.push(whoAmI);
  if (context) sections.push(`WHAT THEY ARE LOOKING AT RIGHT NOW:\n${context}`);
  const system = sections.join("\n\n");

  const run = { type: "guide", uid, status: "running", audit: [], createdAt: new Date() };
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
      finishedAt: new Date(),
    },
    { merge: true }
  );

  return { text: result.text, runId: runRef.id, steps: result.steps };
}

export const askGuide = onCall({ secrets: ["GEMINI_API_KEY"] }, async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  const message = String(request.data?.message || "").trim().slice(0, 4000);
  if (!message) throw new HttpsError("invalid-argument", "Ask a question.");
  const context = String(request.data?.context || "").trim().slice(0, 600);

  const { llm, genConfig } = await resolveLlm(db, "guide", process.env.GEMINI_API_KEY, { familyId, uid, source: "askGuide" });
  if (!llm) {
    return {
      text: "The AI guide isn't configured yet — set the GEMINI_API_KEY secret to enable it.",
      configured: false,
    };
  }

  // This guardian's own running thread. Load history BEFORE appending the new
  // turn (runAgent appends the user message itself), then persist both sides.
  const messages = familyPaths(db, familyId).guideMessages(uid);
  const history = await loadHistory(messages);
  await messages.add({ role: "user", uid, text: message, at: new Date() });

  const { text, runId } = await runGuide({ db, familyId, uid, role, message, history, context, llm, genConfig });

  await messages.add({ role: "assistant", uid, text, runId, at: new Date() });
  return { text, runId, configured: true };
});

// Wipe THIS guardian's guide thread so a polluted/derailed context can be reset.
// Scoped to the caller's own thread (intercom/{uid}/messages) — never touches
// another member's conversation. Deletes in batches to stay within limits.
export const clearGuideHistory = onCall(async (request) => {
  const { db, uid, familyId } = await resolveCaller(request);
  const messages = familyPaths(db, familyId).guideMessages(uid);
  let cleared = 0;
  // Loop until the thread is empty (each batch caps at 300 deletes).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await messages.limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    cleared += snap.size;
    if (snap.size < 300) break;
  }
  return { cleared };
});
