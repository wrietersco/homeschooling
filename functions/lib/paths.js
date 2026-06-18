// Server-side Firestore path helpers (Admin SDK). Mirrors the client tenant
// model and is the single source of truth for collection layout used by every
// agent tool and scheduled job. Kept deliberately small in Phase 0 and grown
// per phase alongside the data model in plan.md §3.

/** @param {import("firebase-admin/firestore").Firestore} db */
export function familyPaths(db, familyId) {
  if (!familyId) throw new Error("familyId required");
  const root = db.collection("families").doc(familyId);
  return {
    familyId,
    family: () => root,
    meta: () => root.collection("meta").doc("app"),
    members: () => root.collection("members"),
    member: (uid) => root.collection("members").doc(uid),
    profile: () => root.collection("profile").doc("family"),
    guardians: () => root.collection("guardians"),
    children: () => root.collection("children"),
    child: (childId) => root.collection("children").doc(childId),
    skills: () => root.collection("skills"),
    curriculum: () => root.collection("curriculum"),
    activities: () => root.collection("activities"),
    calendarDays: () => root.collection("calendarDays"),
    scores: () => root.collection("scores"),
    observations: () => root.collection("observations"),
    exposures: () => root.collection("exposures"),
    contentStats: () => root.collection("contentStats"),
    agentIndex: () => root.collection("_agent_index"),
    agentRuns: () => root.collection("agentRuns"),
    intercom: () => root.collection("intercom"),
  };
}

export function platformLlmConfig(db) {
  return db.collection("platform").doc("llm_config");
}

export function userRef(db, uid) {
  return db.collection("users").doc(uid);
}
