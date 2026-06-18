import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Ask the read-only guide agent a question about your family's data.
export async function askGuide(message) {
  const call = httpsCallable(functions, "askGuide");
  const res = await call({ message });
  return res.data; // { text, runId?, configured }
}
