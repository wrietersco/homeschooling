import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _generateSyllabus = httpsCallable(functions, "generateSyllabus");

export async function generateSyllabus(curriculumId) {
  const res = await _generateSyllabus({ curriculumId });
  return res.data;
}
