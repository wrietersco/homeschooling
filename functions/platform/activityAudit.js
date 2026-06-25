// Activity differentiation audit (read-only, Phase 1).
//
// WHY: content is stored once per activity (activities/{id}.content) and the
// player renders that single blob for every targeted child — see
// ActivityPlayerView.vue. So when one activity targets several children who are
// at DIFFERENT levels (e.g. Noorani Qaida, where one child is ahead of another),
// they all get identical material. There is no per-child content axis, and the
// syllabus picks `targetChildren` with an "all children" fallback
// (syllabus.js resolveTargetChildren), so skill-paced work gets silently clubbed.
//
// This routine does NOT mutate anything. It reads the family's activities +
// children and produces a PLAN: which activities are individually-paced yet
// clubbed across multiple children, and what the restructure would be. A later
// apply phase (separate, guarded) consumes this plan to split/retarget and
// regenerate per-child content. Auditing first lets us inspect the real data and
// confirm the classification before touching production.
//
// The classifier is deliberately a PURE heuristic on structural fields (type +
// coopMode + targetChildren). The DIFFERENTIATION EVIDENCE itself (who is ahead
// of whom) lives in free-text child fields (strengths/weaknesses/comments) which
// the agents don't currently consume — so the audit only flags *candidates*; it
// never invents a leveling decision. The human (or a later LLM apply pass) levels.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";
import { contentKindForType } from "../agents/activityContent.js";

// Types that progress at an INDIVIDUAL child's pace — reading/recitation/maths
// where one child can legitimately be ahead of a sibling. These are the types
// where clubbing several children onto one content blob is a real problem.
//
// Excluded on purpose: teaching / conversation / physical / computer / ai_robotics.
// Those are FORMAT/group activities (a parent-led session, a two-voice dialogue,
// a shared game) where one shared artifact serving everyone — even with one child
// "driving" — is the intended design, NOT a defect. The differentiation axis is
// orthogonal to type, so we never key the rule on subject alone.
export const SKILL_PACED_TYPES = new Set([
  "quran",
  "noorani_qaida",
  "arabic_reading",
  "urdu_reading",
  "english_reading",
  "mathematics",
]);

const str = (v) => (typeof v === "string" ? v.trim() : "");

// Classify ONE activity's differentiation posture. Pure + exported for tests.
//   paced:          "individual" (skill-paced, not co-op) | "shared"
//   clubbed:        true when an individually-paced activity serves >1 child on
//                   a single content blob — the structural defect we audit for.
//   recommendation: "split-per-child" | "review-coop" | "keep-shared"
export function classifyActivity(activity = {}) {
  const type = str(activity.type) || "teaching";
  const coopMode = Boolean(activity.coopMode);
  const targets = Array.isArray(activity.targetChildren) ? activity.targetChildren.filter(Boolean) : [];
  const skillPaced = SKILL_PACED_TYPES.has(type);
  const paced = skillPaced && !coopMode ? "individual" : "shared";
  const clubbed = paced === "individual" && targets.length > 1;

  let recommendation = "keep-shared";
  let rationale = "";
  if (clubbed) {
    recommendation = "split-per-child";
    rationale = `${type} is individually paced but targets ${targets.length} children on one shared content blob — split into one activity per child and level each to that child's profile.`;
  } else if (skillPaced && coopMode && targets.length > 1) {
    // Skill-paced AND flagged co-op: legitimate sometimes (shared recitation),
    // but worth a human glance — co-op on a per-pace skill can hide a mismatch.
    recommendation = "review-coop";
    rationale = `${type} is skill-paced yet marked co-op for ${targets.length} children — verify they are genuinely at the same level, otherwise split.`;
  } else if (paced === "individual" && targets.length <= 1) {
    rationale = "Individually paced and already single-child — no change needed.";
  } else {
    rationale = "Shared/format activity — one artifact for the group is intended.";
  }

  return {
    type,
    contentKind: contentKindForType(type),
    coopMode,
    targetCount: targets.length,
    paced,
    clubbed,
    recommendation,
    rationale,
  };
}

// Roll per-activity reports up into family-level totals. Pure + exported.
export function summarizeAudit(reports = []) {
  return {
    total: reports.length,
    individualPaced: reports.filter((r) => r.paced === "individual").length,
    clubbed: reports.filter((r) => r.clubbed).length,
    toSplit: reports.filter((r) => r.recommendation === "split-per-child").length,
    toReview: reports.filter((r) => r.recommendation === "review-coop").length,
  };
}

// Read-only audit pass for one family. Returns the plan; mutates nothing.
export async function runActivityAudit({ db, familyId }) {
  const p = familyPaths(db, familyId);
  const [actSnap, childSnap] = await Promise.all([
    p.activities().limit(500).get(),
    p.children().limit(30).get(),
  ]);

  // Children, with the free-text fields where leveling evidence actually lives,
  // so a reviewer can read "Hadi advanced / Ibrahim basic" alongside the flags.
  const children = childSnap.docs.map((d) => {
    const c = d.data();
    return {
      id: d.id,
      name: str(c.name) || d.id,
      dob: str(c.dob),
      strengths: str(c.strengths),
      weaknesses: str(c.weaknesses),
      goals: str(c.goals),
      comments: str(c.comments),
    };
  });
  const nameById = new Map(children.map((c) => [c.id, c.name]));

  const activities = actSnap.docs.map((d) => {
    const a = d.data();
    const targets = Array.isArray(a.targetChildren) ? a.targetChildren.filter(Boolean) : [];
    const cls = classifyActivity(a);
    return {
      id: d.id,
      title: str(a.title) || "Untitled",
      subject: str(a.subject),
      subjectId: str(a.subjectId),
      complexityRank: Number(a.complexityRank) || 1,
      hasContent: Boolean(a.content),
      targetChildren: targets,
      targetNames: targets.map((id) => nameById.get(id) || id),
      ...cls,
    };
  });

  // Surface the actionable ones first, hardest cases on top.
  activities.sort((a, b) =>
    Number(b.clubbed) - Number(a.clubbed) ||
    a.subject.localeCompare(b.subject) ||
    a.complexityRank - b.complexityRank
  );

  return {
    familyId,
    generatedAt: new Date(),
    children,
    summary: summarizeAudit(activities),
    activities,
  };
}

// Callable — owner/parent run the read-only audit and review the plan in the UI.
// No daily-limit gate: it makes no AI calls, only Firestore reads.
export const auditActivityDifferentiation = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { db, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can audit activities.");
  }
  const plan = await runActivityAudit({ db, familyId });
  return { configured: true, ...plan };
});
