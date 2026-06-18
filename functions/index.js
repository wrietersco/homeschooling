// Cloud Functions entry point (gen 2, ESM).
// Phase 0 ships a single health-check callable so the emulator + hosting
// rewrite (/api/agent) wire up end to end. Real agent endpoints, scheduled
// jobs, and media functions are added in their respective phases.
import { initializeApp } from "firebase-admin/app";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

// Default Storage bucket for AI-generated activity images. Firebase's modern
// default bucket is `<project>.firebasestorage.app` (created when Storage is
// enabled). Overridable via STORAGE_BUCKET env.
const __projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "homeschooling-b3e57";
initializeApp({
  storageBucket: process.env.STORAGE_BUCKET || `${__projectId}.firebasestorage.app`,
});

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Phase 1 — auth & onboarding.
export { createFamily } from "./auth/onboarding.js";

// Phase 2 — skills registry.
export { createGlobalSkill } from "./skills/registry.js";

// Phase 3 — AI agent runtime.
export { askGuide } from "./agents/guide.js";

// Phase 4 — Curriculum agent.
export { askCurriculum } from "./agents/curriculum.js";

// Phase 5 — Syllabus builder.
export { generateSyllabus } from "./agents/syllabus.js";

// Activity content — type-specific content (verses / problems / story / steps).
export { generateActivityContent, backfillActivityContent } from "./agents/activityContent.js";

// Text-to-speech — click-to-hear any word/phrase/paragraph (Gemini voices).
export { synthesizeSpeech } from "./agents/tts.js";

// Planner auto-scheduler — lays the syllabus onto a week's calendar.
export { autoSchedule } from "./agents/scheduler.js";
// Agent DB-index maintenance triggers (one per tracked collection).
import { buildIndexTriggers } from "./agents/agentIndex.js";
const __indexTriggers = buildIndexTriggers();
export const idx_children = __indexTriggers.idx_children;
export const idx_guardians = __indexTriggers.idx_guardians;
export const idx_skills = __indexTriggers.idx_skills;
export const idx_curriculum = __indexTriggers.idx_curriculum;
export const idx_activities = __indexTriggers.idx_activities;
export const idx_observations = __indexTriggers.idx_observations;
export const idx_scores = __indexTriggers.idx_scores;

// Phase 8 — Super Admin callables.
export { listFamilies, setFamilyStatus, listFamilyMembers, setMemberRole, removeMember, deleteFamily, getLlmConfig, setLlmConfig } from "./platform/admin.js";

// Phase 10 — Demo data seeder (superadmin-only).
export { seedDemoFamily } from "./platform/seeder.js";

// Invite system — family owner creates shareable links; invited users accept.
export { createInvite, acceptInvite } from "./platform/invites.js";

// Lifecycle deletes — family admins + superadmin remove curriculum / syllabus.
export { deleteCurriculum, deleteSyllabus } from "./platform/lifecycle.js";

// TEMPORARY verification endpoint for the AI image storage path. Remove after.
export const testImageGen = onRequest({ cors: true, secrets: ["GEMINI_API_KEY"] }, async (req, res) => {
  if (req.query.k !== "verify-7a2f") { res.status(403).send("forbidden"); return; }
  try {
    const { generateActivityImage } = await import("./agents/imageGen.js");
    const result = await generateActivityImage({
      scene: "a friendly camel resting by date palms in a desert",
      apiKey: process.env.GEMINI_API_KEY,
      pathHint: "verify/test",
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// Reachable at /api/agent via the hosting rewrite. Returns a small JSON payload
// confirming the function tier is alive. Replaced by the real agent runtime in
// Phase 3.
export const agent = onRequest({ cors: true }, (req, res) => {
  res.json({
    ok: true,
    service: "dar-al-hikmah-functions",
    phase: 0,
    message: "agent runtime placeholder — implemented in Phase 3",
  });
});
