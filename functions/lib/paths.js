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
    // Cost metering: one deep doc per paid AI call (90-day retention), plus
    // rollup counter docs keyed by period (YYYY-MM / YYYY-MM-DD) for summaries.
    costEvents: () => root.collection("costEvents"),
    costRollups: () => root.collection("costRollups"),
    intercom: () => root.collection("intercom"),
    // Per-guardian guide chat thread: each member keeps their own running
    // conversation under intercom/{uid}/messages so the guide remembers what
    // THIS guardian has been asking. Covered by the intercom security rule.
    guideMessages: (uid) => root.collection("intercom").doc(uid).collection("messages"),
  };
}

export function platformLlmConfig(db) {
  return db.collection("platform").doc("llm_config");
}

// Superadmin-editable per-model pricing (overrides the code defaults in
// costMeter.js). Rates are snapshotted into each cost event so historical
// figures stay stable even after a rate change.
export function platformPricing(db) {
  return db.collection("platform").doc("pricing");
}

// Platform-wide cost rollups (all families combined), keyed by period.
export function platformCostRollups(db) {
  return db.collection("platformCostRollups");
}

export function userRef(db, uid) {
  return db.collection("users").doc(uid);
}
