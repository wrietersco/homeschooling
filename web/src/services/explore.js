import { httpsCallable } from "firebase/functions";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";

// Ask the server for a locked, single-use Gemini Live token for one child.
// Returns { configured, token, model, config, sessionId, childName, maxMinutes }
// or { configured:false, message } when the API key isn't set.
export async function startExploreSession({ childId, mode, focus = "" }) {
  return (await httpsCallable(functions, "startExploreSession")({ childId, mode, focus })).data;
}

// Answer one of the live model's tool calls (child-scoped, size-capped).
// `sessionId` lets the buddy file its highlights against THIS conversation; the
// server re-verifies that the session belongs to this family and child.
export async function callExploreTool({ childId, name, args, sessionId = "" }) {
  return (await httpsCallable(functions, "exploreTool")({ childId, name, args, sessionId })).data.result;
}

export function endExploreSession(sessionId, transcript) {
  return httpsCallable(functions, "endExploreSession")({ sessionId, transcript }).then((r) => r.data);
}

// ── Session history (parents) ────────────────────────────────────────────────
// The buddy files its own pedagogical highlights during a conversation
// (record_session_highlights). Family members may read the log directly — rules
// allow read, and only Cloud Functions write it — so this is a plain query.
export async function loadExploreSessions(familyId, childId, max = 5) {
  const q = query(
    collection(db, "families", familyId, "exploreSessions"),
    where("childId", "==", childId),
    orderBy("startedAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const s = d.data();
    return {
      id: d.id,
      mode: s.mode === "learn" ? "learn" : "explore",
      focus: s.focus || "",
      startedAt: s.startedAt?.toDate?.() || null,
      // Newest highlight first — that's the one a parent wants at a glance.
      highlights: (Array.isArray(s.highlights) ? s.highlights : [])
        .map(({ at, ...rest }) => rest)
        .reverse(),
    };
  });
}
