// Skill mapping agent — the parent clicks "Build skill map" on the Skills screen
// and an agent reviews ALL the family's data (children, activities, existing
// skills, guiding light) and produces a single source of truth linking
//
//     child  →  skill  →  the activities that develop it  →  time + extent
//
// It works one CHILD at a time (a handful of LLM calls, not one-per-activity),
// writing progress to agentRuns/{runId} after each child so the UI can show a
// live picture exactly like the syllabus builder. On completion it:
//   • repairs every activity's `targetChildren` to REAL child ids (fixing the
//     "No children assigned" bug in the player + the blank planner filter),
//   • ensures every skill the agent used exists in families/{id}/skills,
//   • binds each skill to the children who develop it (children/{cid}/skills),
//   • writes the rendered board to families/{id}/meta/skillMap.
//
// All timestamps use new Date() (admin prototype-clash avoidance, per the rest
// of the codebase).
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { runAgent } from "./runtime.js";
import { resolveLlm } from "./agentConfig.js";
import { describeGuardian, summarizeChildPerformance } from "./grounding.js";

// Stable id from a skill name so re-runs update the same skill rather than
// duplicating it, and so it lines up with the family skills collection.
function skillSlug(name) {
  return String(name || "skill").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";
}
const clampExtent = (v) => Math.min(5, Math.max(1, Math.round(Number(v) || 1)));

// ─── Per-child tool ───────────────────────────────────────────────────────────
const RECORD_DECLARATION = {
  name: "record_child_skills",
  description:
    "Record the skills THIS child develops over the 6-month plan and exactly which of the listed activities develop each one. Call once.",
  parameters: {
    type: "object",
    properties: {
      activityIds: {
        type: "array",
        items: { type: "string" },
        description: "IDs (from the provided activity list ONLY) of every activity that is appropriate for and assigned to THIS child.",
      },
      skills: {
        type: "array",
        description: "The distinct skills this child develops. Group activities under the skill they build.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Concise skill name, e.g. 'Quranic Arabic vocabulary', 'Addition within 20'." },
            category: { type: "string", description: "Short grouping, e.g. \"Qur'an\", 'Mathematics', 'Language', 'Character'." },
            extent: { type: "number", description: "How far THIS child develops it by the end: 1=introduced, 2=basic, 3=competent, 4=advanced, 5=mastered." },
            activityIds: {
              type: "array",
              items: { type: "string" },
              description: "IDs of the activities (from the list) that develop THIS skill for THIS child.",
            },
          },
          required: ["name", "activityIds"],
        },
      },
    },
    required: ["activityIds", "skills"],
  },
};

function ageFromDob(dob) {
  if (!dob) return null;
  const t = Date.parse(dob);
  if (Number.isNaN(t)) return null;
  const yrs = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
  return yrs > 0 && yrs < 25 ? Math.floor(yrs) : null;
}

function buildChildPrompt({ child, guidingLight, guardians, activityLines, existingSkillNames, childPerformance = "" }) {
  const age = ageFromDob(child.dob);
  return [
    "You map a homeschooling child's learning: which SKILLS they develop and which activities build each one.",
    "",
    `CHILD: ${child.name || child.id}${age != null ? ` · about ${age} years old` : ""}${child.dob ? ` (dob ${child.dob})` : ""}.`,
    `Guiding light (everything must serve this): ${guidingLight || "(not set)"}.`,
    guardians.length ? `Guardians: ${guardians.join("; ")}.` : "",
    childPerformance ? `\n${childPerformance}\nGround each skill's \`extent\` in ${child.name || "this child"}'s actual progress above — how far THEY get, not the activity's ceiling.` : "",
    "",
    "AVAILABLE ACTIVITIES (use ONLY these ids):",
    ...activityLines,
    "",
    existingSkillNames.length
      ? `Skills the family already tracks (reuse these names when they fit, and add new ones freely): ${existingSkillNames.join("; ")}.`
      : "There are no pre-existing skills — name skills sensibly as you see fit.",
    "",
    "INSTRUCTIONS:",
    "- Pick the activities that suit THIS child's age and level; an activity may suit several children.",
    "- Define a focused set of skills (aim for 4-12) this child genuinely develops across the plan.",
    "- Under each skill, list the activity ids that build it. An activity can support more than one skill.",
    "- Set `extent` honestly for where this child lands by month 6.",
    "- Reuse existing skill names where they fit; invent clear new ones otherwise.",
    "Call record_child_skills exactly once. Do not write prose outside the tool call.",
  ].filter(Boolean).join("\n");
}

// ─── Core (exported for tests) ────────────────────────────────────────────────
export async function runSkillMap({ db, familyId, uid, role = "owner", llm, genConfig }) {
  const famRef = db.collection("families").doc(familyId);

  const [childrenSnap, guardiansSnap, profileSnap, activitiesSnap, skillsSnap] = await Promise.all([
    famRef.collection("children").limit(30).get(),
    famRef.collection("guardians").limit(20).get(),
    famRef.collection("profile").doc("family").get(),
    famRef.collection("activities").limit(500).get(),
    famRef.collection("skills").limit(200).get(),
  ]);

  const children = childrenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!children.length) throw new HttpsError("failed-precondition", "Add at least one child before building the skill map.");
  const guardians = guardiansSnap.docs.map((d) => describeGuardian(d.data(), d.id));
  const guidingLight = profileSnap.exists ? (profileSnap.data().guidingLight || "") : "";
  const activities = activitiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!activities.length) throw new HttpsError("failed-precondition", "Generate a syllabus first — there are no activities to map.");
  const activitiesById = new Map(activities.map((a) => [a.id, a]));
  const existingSkillNames = skillsSnap.docs.map((d) => d.data().name).filter(Boolean);
  // Completion history + recent observations (read once for the whole family) so
  // the agent grades each child's skill `extent` against real progress, not guesses.
  const childPerformance = await summarizeChildPerformance(db, familyId, children);

  const activityLines = activities.map(
    (a) => `- ${a.id} · "${a.title}" · ${a.type} · ${a.subject || ""} · rank ${a.complexityRank || 1} · ${a.durationMinutes || 30}min`
  );

  // Progress doc — same shape language as the syllabus run so the UI is familiar.
  const runRef = famRef.collection("agentRuns").doc();
  const childrenState = {};
  for (const c of children) childrenState[c.id] = { name: c.name || c.id, status: "pending", skillCount: 0, activityCount: 0 };
  await runRef.set({
    type: "skillmap",
    uid, role,
    status: "running",
    children: childrenState,
    totalChildren: children.length,
    completedChildren: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Accumulators across children.
  const skillRegistry = new Map(); // slug -> { id, name, category }
  const activityTargets = new Map(); // activityId -> Set(childId)
  // board[childId] = { name, skills: [{ skillId, name, category, extent, totalMinutes, activities:[{id,title,type,minutes}] }] }
  const board = {};

  let completed = 0;
  for (const child of children) {
    await runRef.update({ [`children.${child.id}.status`]: "running", currentChildId: child.id, updatedAt: new Date() });
    try {
      let captured = null;
      const tools = {
        async record_child_skills(args) { captured = args || {}; return { saved: true }; },
      };
      const system = buildChildPrompt({ child, guidingLight, guardians, activityLines, existingSkillNames, childPerformance });
      await runAgent({
        llm, system,
        toolDeclarations: [RECORD_DECLARATION],
        tools,
        userMessage: `Map the skills and activities for ${child.name || child.id} now and call record_child_skills once.`,
        maxSteps: 4,
        generationConfig: genConfig ?? { maxOutputTokens: 8192, temperature: 0.3 },
      });

      const childSkills = [];
      const claimed = new Set();
      // Activities the child is assigned (validated against the real list).
      for (const aid of Array.isArray(captured?.activityIds) ? captured.activityIds : []) {
        if (activitiesById.has(aid)) claimed.add(aid);
      }
      for (const s of Array.isArray(captured?.skills) ? captured.skills : []) {
        const name = String(s?.name || "").trim();
        if (!name) continue;
        const slug = skillSlug(name);
        const category = String(s?.category || "").trim();
        if (!skillRegistry.has(slug)) skillRegistry.set(slug, { id: slug, name, category });
        const acts = [];
        let totalMinutes = 0;
        for (const aid of Array.isArray(s?.activityIds) ? s.activityIds : []) {
          const a = activitiesById.get(aid);
          if (!a) continue;
          claimed.add(aid);
          const minutes = Number(a.durationMinutes) || 30;
          totalMinutes += minutes;
          acts.push({ id: a.id, title: a.title || "Activity", type: a.type || "teaching", minutes });
        }
        if (!acts.length) continue;
        childSkills.push({ skillId: slug, name, category, extent: clampExtent(s?.extent), totalMinutes, activities: acts });
      }
      for (const aid of claimed) {
        if (!activityTargets.has(aid)) activityTargets.set(aid, new Set());
        activityTargets.get(aid).add(child.id);
      }
      board[child.id] = { name: child.name || child.id, skills: childSkills };

      completed += 1;
      await runRef.update({
        [`children.${child.id}.status`]: "done",
        [`children.${child.id}.skillCount`]: childSkills.length,
        [`children.${child.id}.activityCount`]: claimed.size,
        completedChildren: completed,
        currentChildId: null,
        updatedAt: new Date(),
      });
    } catch (e) {
      board[child.id] = { name: child.name || child.id, skills: [] };
      await runRef.update({
        [`children.${child.id}.status`]: "error",
        [`children.${child.id}.error`]: String(e?.message || e).slice(0, 300),
        currentChildId: null,
        updatedAt: new Date(),
      });
    }
  }

  // ── Persist results ──────────────────────────────────────────────────────────
  // 1) Ensure each skill exists in the family skills collection (managed list),
  //    AND prune agent-managed skills that this run no longer uses (the "delete"
  //    half of managing skills). Parent-added skills (source registry/manual) are
  //    never touched — the agent only removes what the agent itself created.
  const skillsCol = famRef.collection("skills");
  const usedSlugs = new Set(skillRegistry.keys());
  await Promise.all([...skillRegistry.values()].map((s) =>
    skillsCol.doc(s.id).set({ name: s.name, category: s.category || "", source: "agent", updatedAt: new Date() }, { merge: true })
  ));
  await Promise.all(
    skillsSnap.docs
      .filter((d) => d.data().source === "agent" && !usedSlugs.has(d.id))
      .map((d) => d.ref.delete())
  );

  // 2) Repair activity → children bindings + attach a per-activity skill summary.
  const skillsByActivity = new Map(); // activityId -> [{ skillId, name, extent }]
  for (const [cid, entry] of Object.entries(board)) {
    for (const s of entry.skills) {
      for (const a of s.activities) {
        if (!skillsByActivity.has(a.id)) skillsByActivity.set(a.id, []);
        const list = skillsByActivity.get(a.id);
        if (!list.some((x) => x.skillId === s.skillId)) list.push({ skillId: s.skillId, name: s.name, extent: s.extent });
      }
    }
    void cid;
  }
  const allChildIds = children.map((c) => c.id);
  const batch = db.batch();
  for (const a of activities) {
    const targetSet = activityTargets.get(a.id);
    const targets = targetSet && targetSet.size ? [...targetSet] : allChildIds; // unclaimed → everyone
    batch.update(famRef.collection("activities").doc(a.id), {
      targetChildren: targets,
      skills: skillsByActivity.get(a.id) || [],
      skillMappedAt: new Date(),
    });
  }
  await batch.commit();

  // 3) Bind skills to the children who develop them (per-child tracking), and
  //    remove agent-made bindings a child no longer has (e.g. outgrown). Again,
  //    only agent-created bindings are pruned; manual ones the parent ticked stay.
  await Promise.all(children.map(async (child) => {
    const entry = board[child.id] || { skills: [] };
    const want = new Set(entry.skills.map((s) => s.skillId));
    const col = famRef.collection("children").doc(child.id).collection("skills");
    const existing = await col.get();
    const ops = entry.skills.map((s) =>
      col.doc(s.skillId).set({
        skillId: s.skillId, name: s.name, category: s.category || "",
        status: "active", extent: s.extent, source: "agent", boundAt: new Date(),
      }, { merge: true })
    );
    for (const d of existing.docs) {
      if (d.data().source === "agent" && !want.has(d.id)) ops.push(d.ref.delete());
    }
    await Promise.all(ops);
  }));

  // 4) Write the rendered board (the client subscribes to this).
  const totalSkills = skillRegistry.size;
  await famRef.collection("meta").doc("skillMap").set({
    status: "done",
    runId: runRef.id,
    generatedAt: new Date(),
    skills: [...skillRegistry.values()],
    children: board,
    totalSkills,
  });

  await runRef.update({ status: "done", totalSkills, finishedAt: new Date(), updatedAt: new Date() });
  return { runId: runRef.id, totalChildren: children.length, totalSkills };
}

// ─── Callable ─────────────────────────────────────────────────────────────────
// Runs inline (up to 540s) and writes live progress to agentRuns as it goes, so
// the client subscribes to the run doc for a live picture while awaiting.
export const requestSkillMap = onCall(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 540 },
  async (request) => {
    const { db, uid, familyId, role } = await resolveCaller(request);
    if (!["owner", "parent"].includes(role)) {
      throw new HttpsError("permission-denied", "Only family owners or parents can build the skill map.");
    }
    // Reuse the curriculum agent's config (larger output budget) for rich mapping.
    const { llm, genConfig } = await resolveLlm(db, "curriculum", process.env.GEMINI_API_KEY, { familyId, uid, source: "requestSkillMap" });
    if (!llm) {
      return { configured: false, text: "The skill-mapping agent isn't configured — set the GEMINI_API_KEY secret to enable it." };
    }
    const res = await runSkillMap({ db, familyId, uid, role, llm, genConfig });
    return { configured: true, ...res };
  }
);
