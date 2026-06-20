import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _generateSyllabus = httpsCallable(functions, "generateSyllabus");
const _stopSyllabus = httpsCallable(functions, "stopSyllabus");

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
