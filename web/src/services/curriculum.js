import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _askCurriculum = httpsCallable(functions, "askCurriculum");

// history: Gemini-format array [{role:"user"|"model", parts:[{text:string}]}]
// Accumulated by the caller across turns for multi-turn context.
export async function askCurriculum(message, history = []) {
  const res = await _askCurriculum({ message, history });
  return res.data;
}
