// Per-family grounding. Every agent call composes: platform-wide system
// instructions (superadmin-owned) + the family's own context (guiding light,
// children, agent index summary). Strictly tenant-scoped — only this family's
// data is ever injected, never another family's (plan.md LLM-tenancy invariant).
import { familyPaths } from "../lib/paths.js";
import { loadAgentConfig } from "./agentConfig.js";
import { loadBriefForGrounding } from "./knowledgeBrief.js";

// Superadmin-authored instructions for an agent: the global default text plus
// any per-agent override, concatenated. Empty string when neither is set.
export async function loadPlatformInstructions(db, agentKey = "guide") {
  const cfg = await loadAgentConfig(db, agentKey);
  return (cfg.systemInstructions || "").trim();
}

// One-line summary of a guardian, including a compact availability digest when
// present. Shared by the family-context block and the syllabus/scheduler agents.
export function describeGuardian(g, id) {
  const bits = [g.name || id];
  if (g.relationship || g.role) bits.push(`(${g.relationship || g.role})`);
  if (g.motherTongue) bits.push(`— mother tongue ${g.motherTongue}`);
  const avail = availabilitySummary(g.availability);
  if (avail) bits.push(`— available ${avail}`);
  return `- ${bits.join(" ")}`;
}

// Turn a { mon: [{start,end}], ... } availability map into a short readable line.
export function availabilitySummary(availability) {
  if (!availability || typeof availability !== "object") return "";
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const parts = [];
  for (const d of DAYS) {
    const ranges = Array.isArray(availability[d]) ? availability[d] : [];
    const spans = ranges
      .filter((r) => r && r.start && r.end)
      .map((r) => `${r.start}-${r.end}`);
    if (spans.length) parts.push(`${d} ${spans.join(",")}`);
  }
  return parts.join("; ");
}

// Per-child performance digest (#8): completion history + recent observations,
// so agents can personalise difficulty and pacing for THIS child. Completion-
// focused only — never ranks children against each other. Best-effort: returns
// "" on any read failure so it can never block an agent. `children` is an array
// of { id, name }. Computed ONCE per agent run and threaded into prompts (callers
// must not call this per-activity — it reads the scores/observations collections).
export async function summarizeChildPerformance(db, familyId, children = []) {
  if (!children.length) return "";
  try {
    const root = db.collection("families").doc(familyId);
    const [scoresSnap, obsSnap] = await Promise.all([
      root.collection("scores").limit(500).get(),
      root.collection("observations").limit(150).get(),
    ]);
    const byChild = {};
    for (const c of children) byChild[c.id] = { name: c.name || c.id, done: 0, total: 0, obs: [] };
    for (const d of scoresSnap.docs) {
      const s = d.data();
      const cell = byChild[s.childId];
      if (!cell) continue;
      cell.total += 1;
      if (s.completed) cell.done += 1;
    }
    for (const d of obsSnap.docs) {
      const o = d.data();
      const cell = byChild[o.childId];
      if (!cell || !o.text || cell.obs.length >= 3) continue;
      cell.obs.push(String(o.text).slice(0, 140));
    }
    const lines = Object.values(byChild).map((c) => {
      const hist = c.total ? `completed ${c.done}/${c.total} scheduled activities` : "no activity history yet";
      const obs = c.obs.length ? ` Recent observations: ${c.obs.join(" | ")}.` : "";
      return `- ${c.name}: ${hist}.${obs}`;
    });
    if (!lines.length) return "";
    return [
      "CHILD PROGRESS (use to personalise each child's difficulty, pacing, and which",
      "activities target whom — this is completion-focused; NEVER rank children against",
      "each other):",
      ...lines,
    ].join("\n");
  } catch (e) {
    console.warn(`[grounding] summarizeChildPerformance(${familyId}) failed: ${e?.message || e}`);
    return "";
  }
}

// Build a grounded system prompt for an agent in a given family. `agentKey`
// selects the superadmin per-agent system instructions to prepend.
export async function buildGroundedSystemPrompt(db, familyId, basePrompt, agentKey = "guide") {
  const p = familyPaths(db, familyId);
  const [platform, profileSnap, childrenSnap, guardiansSnap, indexSnap, brief] = await Promise.all([
    loadPlatformInstructions(db, agentKey),
    p.profile().get(),
    p.children().limit(20).get(),
    p.guardians().limit(20).get(),
    p.agentIndex().get(),
    loadBriefForGrounding(db, familyId),
  ]);

  const profile = profileSnap.exists ? profileSnap.data() : {};
  const childObjs = childrenSnap.docs.map((d) => ({ id: d.id, name: d.data().name || d.id, dob: d.data().dob || "" }));
  const children = childObjs.map((c) => `- ${c.name}${c.dob ? ` (dob ${c.dob})` : ""}`);
  const guardians = guardiansSnap.docs.map((d) => describeGuardian(d.data(), d.id));
  const index = indexSnap.docs.map((d) => `${d.id}: ${d.data().count ?? "?"}`);
  const childPerformance = await summarizeChildPerformance(db, familyId, childObjs);

  const sections = [];
  if (platform) sections.push(platform);
  if (basePrompt) sections.push(basePrompt);
  sections.push(
    [
      "FAMILY CONTEXT (only this family's data — never reference any other family):",
      `Family: ${profile.familyName || "(unnamed)"}`,
      `Main guiding light: ${profile.guidingLight || "(not set)"} — weight this heavily.`,
      `Goal mode: ${profile.goalMode || "individual"}`,
      guardians.length ? `Guardians (parents/teachers):\n${guardians.join("\n")}` : "Guardians: none yet.",
      children.length ? `Children:\n${children.join("\n")}` : "Children: none yet.",
      index.length ? `Data available (collection: count): ${index.join(", ")}` : "",
      "Use the provided tools to read/modify data. Prefer list_collections then targeted queries.",
    ].filter(Boolean).join("\n")
  );
  if (childPerformance) sections.push(childPerformance);
  // Enriched single-source-of-truth brief (curriculum + syllabus + planner +
  // pedagogical narrative), shared by every agent.
  if (brief) sections.push(brief);

  return sections.join("\n\n");
}
