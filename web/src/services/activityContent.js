// Activity content service — triggers server-side generation of the ready-to-do
// content (flashcards / qaida drills / story) and returns the structured payload.
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const _generateActivityContent = httpsCallable(functions, "generateActivityContent");
const _backfillActivityContent = httpsCallable(functions, "backfillActivityContent", { timeout: 540000 });

export async function generateActivityContent(activityId) {
  const res = await _generateActivityContent({ activityId });
  return res.data;
}

// Fill content for all activities missing it. Processes one batch; returns
// { total, processed, remaining } so the caller can loop until remaining === 0.
export async function backfillActivityContent(limit = 6) {
  const res = await _backfillActivityContent({ limit });
  return res.data;
}
