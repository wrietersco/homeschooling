// Activity differentiation — apply phase (Phase 2 pilot: Noorani Qaida).
//
// The audit (activityAudit.js) flags skill-paced activities that are clubbed
// across children of differing levels. This routine FIXES them WITHOUT splitting
// the activity document (which would orphan calendar blocks + scores). Instead it
// adds a per-child content axis:
//
//   activities/{id}.contentByChild = { [childId]: <content payload> }
//
// The parent player and child player render contentByChild[activeChild] when it
// exists, falling back to the shared `content`. So the activity stays one doc
// (calendar/scores intact) but each child gets material pitched to THEIR level.
//
// Levels are inferred by an LLM from each child's free-text profile
// (strengths/weaknesses/comments) + score history — there is no structured level
// field yet. The inferred level is fed to the existing content generator as
// high-priority guidance, and stored on the activity for transparency.
//
// All timestamps use new Date() (admin prototype-clash avoidance).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";
import { resolveLlm } from "../agents/agentConfig.js";
import { runAgent } from "../agents/runtime.js";
import { describeGuardian, summarizeChildPerformance } from "../agents/grounding.js";
import { loadSubjectPlans, buildPlanContextString } from "../agents/contentPlan.js";
import { generateContentForActivity } from "../agents/activityContent.js";
import { SKILL_PACED_TYPES } from "./activityAudit.js";
import { enforceDailyLimit } from "../lib/rateLimit.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

// ─── Level inference ──────────────────────────────────────────────────────────
const RECORD_LEVELS_DECLARATION = {
  name: "record_levels",
  description:
    "Record where EACH child currently is in this subject and what to teach them next, so their activities can be pitched individually. Call exactly once.",
  parameters: {
    type: "object",
    properties: {
      levels: {
        type: "array",
        description: "One entry per child.",
        items: {
          type: "object",
          properties: {
            childId: { type: "string", description: "The child id, taken EXACTLY from the provided list." },
            level: {
              type: "string",
              description:
                "2-3 sentences: what this child has MASTERED in this subject, where they are NOW, and the specific NEXT step to teach. Be concrete (e.g. 'recognises all isolated letters and blends 2-letter combinations; next: 3-letter words with sukoon').",
            },
          },
          required: ["childId", "level"],
        },
      },
    },
    required: ["levels"],
  },
};

// Infer a per-child level brief for one subject. Pure-ish (LLM call only).
// Returns { [childId]: levelText }. Falls back to "" per child on any failure.
export async function inferSubjectLevels({ subjectName, children, childPerformance, llm, genConfig }) {
  const out = {};
  for (const c of children) out[c.id] = "";
  if (!children.length || !llm) return out;

  const childBlocks = children.map((c) => [
    `Child ${c.name} [id: ${c.id}]${c.dob ? ` (dob ${c.dob})` : ""}:`,
    c.strengths ? `  Strengths: ${c.strengths}` : "",
    c.weaknesses ? `  Weaknesses / working on: ${c.weaknesses}` : "",
    c.goals ? `  Goals: ${c.goals}` : "",
    c.comments ? `  Notes: ${c.comments}` : "",
  ].filter(Boolean).join("\n"));

  const system = [
    `You assess where each child currently stands in the subject "${subjectName}" so their`,
    "activities can be individually paced. Two siblings often differ — do not flatten them to",
    "the same level. Use the profile notes and recent performance below; be concrete and",
    "differentiate clearly. Never rank children against each other — describe each on their own terms.",
    "",
    "CHILD PROFILES:",
    ...childBlocks,
    childPerformance ? `\nRECENT PERFORMANCE:\n${childPerformance}` : "",
    "",
    "Call record_levels exactly once with an entry for every child. Write no prose outside the tool call.",
  ].filter(Boolean).join("\n");

  let captured = null;
  const tools = { async record_levels(args) { captured = args || {}; return { saved: true }; } };
  try {
    await runAgent({
      llm, system,
      toolDeclarations: [RECORD_LEVELS_DECLARATION],
      tools,
      userMessage: `Assess each child's current level in "${subjectName}" and call record_levels once.`,
      maxSteps: 3,
      generationConfig: genConfig ?? { maxOutputTokens: 2048, temperature: 0.3 },
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_levels"] } },
      stopAfterTool: "record_levels",
    });
  } catch (e) {
    console.warn(`[differentiate] level inference failed for "${subjectName}": ${e?.message || e}`);
    return out;
  }

  const known = new Set(children.map((c) => c.id));
  for (const e of Array.isArray(captured?.levels) ? captured.levels : []) {
    const id = str(e.childId);
    if (known.has(id)) out[id] = str(e.level);
  }
  return out;
}

// ─── Apply: generate per-child content for clubbed skill-paced activities ──────
// Bounded + resumable: processes up to `limit` not-yet-differentiated activities,
// returns how many remain so the client can call again. Best-effort per activity.
export async function runDifferentiation({ db, familyId, uid, types = ["noorani_qaida"], limit = 6, llm, genConfig }) {
  const p = familyPaths(db, familyId);
  const typeSet = new Set(types);

  const [actSnap, childSnap, guardSnap, profileSnap] = await Promise.all([
    p.activities().limit(500).get(),
    p.children().limit(30).get(),
    p.guardians().limit(20).get(),
    p.profile().get(),
  ]);

  const children = childSnap.docs.map((d) => {
    const c = d.data();
    return {
      id: d.id, name: str(c.name) || d.id, dob: str(c.dob),
      strengths: str(c.strengths), weaknesses: str(c.weaknesses),
      goals: str(c.goals), comments: str(c.comments),
    };
  });
  const childById = new Map(children.map((c) => [c.id, c]));
  const guardians = guardSnap.docs.map((d) => describeGuardian(d.data(), d.id));
  const guidingLight = profileSnap.exists ? (profileSnap.data().guidingLight || "") : "";
  const childPerformance = await summarizeChildPerformance(db, familyId, children);
  const plans = await loadSubjectPlans(db, familyId);

  // Candidates: requested type, skill-paced, not co-op, >1 target, not already
  // differentiated. Worst (lowest rank) first so the pilot covers the basics.
  const candidates = actSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) =>
      typeSet.has(a.type) &&
      SKILL_PACED_TYPES.has(a.type) &&
      !a.coopMode &&
      Array.isArray(a.targetChildren) && a.targetChildren.filter(Boolean).length > 1 &&
      !a.contentByChild
    )
    .sort((a, b) => (Number(a.complexityRank) || 1) - (Number(b.complexityRank) || 1));

  const totalCandidates = candidates.length;
  const batch = candidates.slice(0, limit);
  if (!batch.length) return { total: 0, processed: 0, remaining: 0, items: [] };

  // Infer levels once per subject (cached) — the expensive bit is shared.
  const levelCache = new Map(); // subjectId -> { childId: levelText }
  async function levelsFor(subjectId, subjectName) {
    if (levelCache.has(subjectId)) return levelCache.get(subjectId);
    const lv = await inferSubjectLevels({ subjectName, children, childPerformance, llm, genConfig });
    levelCache.set(subjectId, lv);
    return lv;
  }

  const items = [];
  for (const activity of batch) {
    const aRef = p.activities().doc(activity.id);
    const targets = activity.targetChildren.filter((id) => childById.has(id));
    try {
      const levels = await levelsFor(activity.subjectId || "__none__", activity.subject || activity.subjectId || "this subject");
      const planContext = activity.subjectId ? buildPlanContextString(plans.get(activity.subjectId), activity.id) : "";

      const byChild = {};
      const usedLevels = {};
      const perChildErrors = [];
      for (const childId of targets) {
        const child = childById.get(childId);
        const levelText = levels[childId] || "";
        usedLevels[childId] = levelText;
        // Generate as if this activity is for THIS child alone, pitched to level.
        const guidance = [
          `This version is for ${child.name} ONLY — the sibling does the same activity at their own level and gets a separate version, so do not average the difficulty.`,
          levelText ? `${child.name}'s current level in ${activity.subject || "this subject"}: ${levelText}` : "",
          "Pitch the difficulty precisely to this child: build on what they have mastered, target their exact next step, and do not include material far beyond it.",
        ].filter(Boolean).join(" ");

        const { content, reason } = await generateContentForActivity({
          activity, children: [child], guardians, guidingLight, childPerformance,
          llm, genConfig, db,
          geminiApiKey: process.env.GEMINI_API_KEY || "",
          storagePrefix: familyId,
          planContext, guidance,
        });
        if (content) byChild[childId] = content;
        else perChildErrors.push(`${child.name}: ${reason || "no content"}`);
      }

      if (Object.keys(byChild).length) {
        await aRef.update({
          contentByChild: byChild,
          differentiatedLevels: usedLevels,
          differentiatedAt: new Date(),
          differentiatedBy: uid,
          differentiationError: perChildErrors.join("; "),
        });
        items.push({
          id: activity.id, title: activity.title || "Activity",
          ok: true, children: Object.keys(byChild).length, error: perChildErrors.join("; "),
        });
      } else {
        await aRef.update({ differentiationError: perChildErrors.join("; ") || "No content produced." }).catch(() => {});
        items.push({ id: activity.id, title: activity.title || "Activity", ok: false, children: 0, error: perChildErrors.join("; ") || "No content produced." });
      }
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 200);
      await aRef.update({ differentiationError: msg }).catch(() => {});
      items.push({ id: activity.id, title: activity.title || "Activity", ok: false, children: 0, error: msg });
    }
  }

  const succeeded = items.filter((i) => i.ok).length;
  return { total: totalCandidates, processed: batch.length, generated: succeeded, remaining: Math.max(0, totalCandidates - succeeded), items };
}

// Callable — owner/parent run the differentiation (pilot defaults to Noorani
// Qaida). Bounded per call; the client re-invokes until remaining hits 0.
export const differentiateActivities = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    if (!["owner", "parent"].includes(role)) {
      throw new HttpsError("permission-denied", "Only family owners or parents can differentiate activities.");
    }
    await enforceDailyLimit(db, familyId, "content"); // shares the content gen budget
    const types = Array.isArray(request.data?.types) && request.data.types.length
      ? request.data.types.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 12)
      : ["noorani_qaida"];
    const limit = Math.min(8, Math.max(1, Number(request.data?.limit) || 4));

    const { llm, genConfig } = await resolveLlm(db, "content", process.env.GEMINI_API_KEY, { familyId, uid, source: "differentiateActivities" });
    if (!llm) return { configured: false, text: "Content generation isn't configured — set the GEMINI_API_KEY secret to enable it." };

    const res = await runDifferentiation({ db, familyId, uid, types, limit, llm, genConfig });
    return { configured: true, ...res };
  }
);
