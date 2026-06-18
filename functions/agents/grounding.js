// Per-family grounding. Every agent call composes: platform-wide system
// instructions (superadmin-owned) + the family's own context (guiding light,
// children, agent index summary). Strictly tenant-scoped — only this family's
// data is ever injected, never another family's (plan.md LLM-tenancy invariant).
import { familyPaths } from "../lib/paths.js";
import { loadAgentConfig } from "./agentConfig.js";

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

// Build a grounded system prompt for an agent in a given family. `agentKey`
// selects the superadmin per-agent system instructions to prepend.
export async function buildGroundedSystemPrompt(db, familyId, basePrompt, agentKey = "guide") {
  const p = familyPaths(db, familyId);
  const [platform, profileSnap, childrenSnap, guardiansSnap, indexSnap] = await Promise.all([
    loadPlatformInstructions(db, agentKey),
    p.profile().get(),
    p.children().limit(20).get(),
    p.guardians().limit(20).get(),
    p.agentIndex().get(),
  ]);

  const profile = profileSnap.exists ? profileSnap.data() : {};
  const children = childrenSnap.docs.map((d) => {
    const c = d.data();
    return `- ${c.name || d.id}${c.dob ? ` (dob ${c.dob})` : ""}`;
  });
  const guardians = guardiansSnap.docs.map((d) => describeGuardian(d.data(), d.id));
  const index = indexSnap.docs.map((d) => `${d.id}: ${d.data().count ?? "?"}`);

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

  return sections.join("\n\n");
}
