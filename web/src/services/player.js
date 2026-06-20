// Activity Player service — token creation, scoring, observations, block status.
// Player tokens live at families/{id}/playerTokens/{uuid} and embed the
// activity data so the unauthenticated child view needs only one Firestore read.
// The compound URL token is "${familyId}.${tokenId}" so the child view can
// look up the family without an extra API hop.
import { collection, addDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function createPlayerToken(familyId, activity, targetChildren, blockId, dateKey, createdBy) {
  const tokenId = crypto.randomUUID();
  const expiresAtMs = Date.now() + 8 * 60 * 60 * 1000;
  await setDoc(doc(db, "families", familyId, "playerTokens", tokenId), {
    activityId: activity.id,
    activityTitle: activity.title,
    type: activity.type || "teaching",
    subject: activity.subject || "",
    complexityRank: activity.complexityRank || 1,
    parentInstructions: activity.parentInstructions || "",
    exampleWalkthrough: activity.exampleWalkthrough || "",
    content: activity.content || null,
    durationMinutes: activity.durationMinutes || 30,
    coopMode: Boolean(activity.coopMode),
    targetChildren: targetChildren || activity.targetChildren || [],
    blockId: blockId || null,
    dateKey: dateKey || null,
    familyId,
    expiresAt: new Date(expiresAtMs),
    // Numeric mirror so security rules can enforce expiry server-side (audit #6).
    expiresAtMs,
    createdBy: createdBy || "",
    createdAt: new Date(),
  });
  return `${familyId}.${tokenId}`;
}

export function submitScore(familyId, score) {
  return addDoc(collection(db, "families", familyId, "scores"), {
    ...score,
    scoredAt: new Date(),
  });
}

export function addObservation(familyId, observation) {
  return addDoc(collection(db, "families", familyId, "observations"), {
    ...observation,
    createdAt: new Date(),
  });
}

export function updateBlockStatus(familyId, dateKey, blockId, status) {
  return updateDoc(
    doc(db, "families", familyId, "calendarDays", dateKey, "blocks", blockId),
    { status }
  );
}
