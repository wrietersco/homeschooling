import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _generateSyllabus = httpsCallable(functions, "generateSyllabus");
const _stopSyllabus = httpsCallable(functions, "stopSyllabus");
const _requestActivityTopUp = httpsCallable(functions, "requestActivityTopUp");
const _ensureDefaultSubjects = httpsCallable(functions, "ensureDefaultSubjects");

export async function startSyllabus(curriculumId) {
  const res = await _generateSyllabus({ curriculumId, targetActivitiesPerSubject: 48 });
  return res.data;
}

// Stop an in-flight syllabus build. The server marks the run cancelled; the
// worker halts after the current subject and stops re-queuing.
export async function stopSyllabus(runId) {
  const res = await _stopSyllabus({ runId });
  return res.data;
}

export async function resumeSyllabus(runId) {
  const res = await _generateSyllabus({ runId });
  return res.data;
}

export async function generateSyllabus(curriculumId) {
  return await startSyllabus(curriculumId);
}

// "Generate more activities" — create brand-new activities of the selected
// type(s) and/or for the selected subject(s), optionally following the
// parent's free-text `guidance`. Reuses stopSyllabus to cancel (the run is
// generic on runId).
export async function requestActivityTopUp({ curriculumId, onlyTypes, onlySubjects, addCount, guidance }) {
  const res = await _requestActivityTopUp({ curriculumId, onlyTypes, onlySubjects, addCount, guidance });
  return res.data;
}

export async function pollActivityTopUp(runId) {
  const res = await _requestActivityTopUp({ runId });
  return res.data;
}

// Make sure the default subject catalog (Geography, Social Studies, History,
// Politics) exists in the curriculum. Idempotent — seeded subjects stay dormant
// until the parent explicitly generates activities for them.
export async function ensureDefaultSubjects(curriculumId) {
  const res = await _ensureDefaultSubjects({ curriculumId });
  return res.data;
}
