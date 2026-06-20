// Cloud Functions entry point (gen 2, ESM).
// Phase 0 ships a single health-check callable so the emulator + hosting
// rewrite (/api/agent) wire up end to end. Real agent endpoints, scheduled
// jobs, and media functions are added in their respective phases.
import { initializeApp } from "firebase-admin/app";
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
export { generateSyllabus, stopSyllabus, syllabusWorker } from "./agents/syllabus.js";

// Activity content — type-specific content (verses / problems / story / steps).
// Backfill runs server-side via a scheduled worker (like the syllabus builder):
// the client enqueues via requestContentBackfill and watches progress.
export { generateActivityContent, deleteActivityContent, backfillActivityContent, requestContentBackfill, stopContentBackfill, contentBackfillWorker, requestContentSample, regenerateFailedContent } from "./agents/activityContent.js";

// Content planning agent — the "plan-first" layer. Designs a coherent per-subject
// learning arc (stored at subjectPlans/{subjectId}) that every content worker
// reads as its canvas, so activities interlink instead of being generated in
// isolation. Button-triggered from the Syllabus screen.
export { requestContentPlanning } from "./agents/contentPlan.js";

// Text-to-speech — click-to-hear any word/phrase/paragraph (Gemini voices).
export { synthesizeSpeech } from "./agents/tts.js";

// Planner auto-scheduler — lays the syllabus onto a week's calendar.
export { autoSchedule } from "./agents/scheduler.js";

// Skill mapping agent — links children ↔ skills ↔ activities (time + extent) and
// repairs activity→child bindings. Button-triggered from the Skills screen.
export { requestSkillMap } from "./agents/skillMap.js";
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

// Knowledge-brief grounding — triggers flag the brief stale; callables rebuild
// it and serve the per-activity parent "journey".
import { buildBriefTriggers } from "./agents/knowledgeBrief.js";
const __briefTriggers = buildBriefTriggers();
export const brief_activities = __briefTriggers.brief_activities;
export const brief_curriculum = __briefTriggers.brief_curriculum;
export const brief_blocks = __briefTriggers.brief_blocks;
export { rebuildKnowledgeBrief, getActivityJourney } from "./agents/knowledgeBrief.js";

// Phase 8 — Super Admin callables.
export { listFamilies, setFamilyStatus, listFamilyMembers, setMemberRole, removeMember, deleteFamily, getLlmConfig, setLlmConfig } from "./platform/admin.js";

// Phase 10 — Demo data seeder (superadmin-only).
export { seedDemoFamily } from "./platform/seeder.js";

// Invite system — family owner creates shareable links; invited users accept.
export { createInvite, acceptInvite } from "./platform/invites.js";

// Lifecycle deletes — family admins + superadmin remove curriculum / syllabus.
export { deleteCurriculum, deleteSyllabus } from "./platform/lifecycle.js";

// Full-Quran import (superadmin) — populates the shared quran/* collection.
export { importQuran, getQuranStatus } from "./platform/quranImport.js";

// Superadmin model tooling — catalog, live preview, and a test-all health check.
export { getModelCatalog, previewModel, testAllModels } from "./platform/modelTools.js";

// Scheduled maintenance — reap stale queue claims, delete expired player tokens,
// and reconcile agent-index counts. (audit #6, #15)
export { maintenanceWorker } from "./platform/maintenance.js";
