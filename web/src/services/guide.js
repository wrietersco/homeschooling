import { httpsCallable } from "firebase/functions";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { functions, db } from "@/lib/firebase";

// Ask the read-only guide agent a question about your family's data. `context`
// is an optional hint about what the guardian is currently looking at (e.g. the
// activity open on the player page) so the guide can answer in-the-moment.
export async function askGuide(message, context = "") {
  const call = httpsCallable(functions, "askGuide");
  const res = await call({ message, context });
  return res.data; // { text, runId?, configured }
}

// Wipe this guardian's guide thread (resets the agent's remembered context).
export async function clearGuideHistory() {
  const call = httpsCallable(functions, "clearGuideHistory");
  const res = await call({});
  return res.data; // { cleared }
}

// Load this guardian's prior guide conversation (their own per-user thread) so
// the chat panel can show where they left off. Oldest-first.
export async function loadGuideHistory(familyId, uid, max = 30) {
  if (!familyId || !uid) return [];
  const q = query(
    collection(db, "families", familyId, "intercom", uid, "messages"),
    orderBy("at", "asc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const m = d.data();
    return { role: m.role === "assistant" ? "assistant" : "user", text: m.text || "" };
  });
}
