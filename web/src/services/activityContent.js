// Activity content service — triggers server-side generation of the ready-to-do
// content (flashcards / qaida drills / story) and returns the structured payload.
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _generateActivityContent = httpsCallable(functions, "generateActivityContent");
const _deleteActivityContent = httpsCallable(functions, "deleteActivityContent");
const _backfillActivityContent = httpsCallable(functions, "backfillActivityContent", { timeout: 540000 });
const _requestContentBackfill = httpsCallable(functions, "requestContentBackfill");
const _stopContentBackfill = httpsCallable(functions, "stopContentBackfill");

export async function generateActivityContent(activityId) {
  const res = await _generateActivityContent({ activityId });
  return res.data;
}

// Delete the generated content for a single activity, returning it to the
// "no content yet" state. Owner/parent only.
export async function deleteActivityContent(activityId) {
  const res = await _deleteActivityContent({ activityId });
  return res.data;
}

// Fill content for all activities missing it. Processes one batch; returns
// { total, processed, remaining } so the caller can loop until remaining === 0.
export async function backfillActivityContent(limit = 6) {
  const res = await _backfillActivityContent({ limit });
  return res.data;
}

// Ask the server to (re)start a backfill for the caller's family. Returns
// immediately — a scheduled worker drains it server-side (like the syllabus
// builder). Progress lives at families/{familyId}/meta/contentBackfill.
export async function requestContentBackfill() {
  const res = await _requestContentBackfill({});
  return res.data;
}

// Stop an in-flight content backfill for the caller's family. The server marks
// the run cancelled; the scheduled worker halts within one activity.
export async function stopContentBackfill() {
  const res = await _stopContentBackfill({});
  return res.data;
}

// Plan-first layer: design a coherent per-subject learning arc (the "canvas")
// that content generation then reads. Pass a subjectId to plan just one subject.
// Runs inline with live progress on agentRuns (type "contentplan").
const _requestContentPlanning = httpsCallable(functions, "requestContentPlanning", { timeout: 540000 });
export async function requestContentPlanning(subjectId = "") {
  const res = await _requestContentPlanning(subjectId ? { subjectId } : {});
  return res.data;
}

// QA sample: generate content for the first N activities of ONE subject so a
// parent/QA tester can quality-check the impact before a full run. Returns the
// generated items. Best with a plan already built for that subject.
const _requestContentSample = httpsCallable(functions, "requestContentSample", { timeout: 540000 });
export async function requestContentSample(subjectId, limit = 6) {
  const res = await _requestContentSample({ subjectId, limit });
  return res.data;
}

// Retry a bounded batch of activities that previously FAILED (carry a
// contentError). Returns { processed, generated, remaining, items }. Optionally
// scope to one subject. Call again to chip through a large backlog.
const _regenerateFailedContent = httpsCallable(functions, "regenerateFailedContent", { timeout: 540000 });
export async function regenerateFailedContent(subjectId = "", limit = 10) {
  const res = await _regenerateFailedContent(subjectId ? { subjectId, limit } : { limit });
  return res.data;
}
