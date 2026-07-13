// Activity Player service — token creation, scoring, observations, block status.
// Player tokens live at families/{id}/playerTokens/{uuid} and embed the
// activity data so the unauthenticated child view needs only one Firestore read.
// The compound URL token is "${familyId}.${tokenId}" so the child view can
// look up the family without an extra API hop.
import { collection, addDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// `forChild` (optional) scopes the link to a single child and embeds that child's
// differentiated content variant (activities/{id}.contentByChild[childId]) when one
// exists. Without it, the link carries the shared blob for all target children.
// Shape: { id, name, level }. Differentiated, level-paced activities (e.g. Noorani
// Qaida) generate one link per child so each device shows material at its own level.
export async function createPlayerToken(familyId, activity, targetChildren, blockId, dateKey, createdBy, forChild) {
  const tokenId = crypto.randomUUID();
  const expiresAtMs = Date.now() + 8 * 60 * 60 * 1000;

  // Resolve the content variant: prefer the named child's variant, else shared.
  const byChild = activity.contentByChild || null;
  const childVariant = forChild?.id && byChild?.[forChild.id] ? byChild[forChild.id] : null;
  const content = childVariant || activity.content || null;
  // Which provider/model wrote the content the child is about to see — the
  // differentiated pass's provider when this link carries a per-child variant,
  // else the shared generation's provider.
  const contentProvider = childVariant ? (activity.differentiatedProvider || "") : (activity.contentProvider || "");
  const contentModel = childVariant ? (activity.differentiatedModel || "") : (activity.contentModel || "");

  await setDoc(doc(db, "families", familyId, "playerTokens", tokenId), {
    activityId: activity.id,
    activityTitle: activity.title,
    type: activity.type || "teaching",
    subject: activity.subject || "",
    complexityRank: activity.complexityRank || 1,
    parentInstructions: activity.parentInstructions || "",
    exampleWalkthrough: activity.exampleWalkthrough || "",
    content,
    contentProvider,
    contentModel,
    // Saved per-element voices travel with the link so the child player plays them
    // (read-only there). Activity-level + keyed by text, so they apply across the
    // shared blob and every child's variant alike.
    audioOverrides: activity.audioOverrides || {},
    durationMinutes: activity.durationMinutes || 30,
    coopMode: Boolean(activity.coopMode),
    // A child-scoped link targets only that child; otherwise all target children.
    targetChildren: forChild?.id ? [forChild.id] : (targetChildren || activity.targetChildren || []),
    // Differentiation metadata so the child view can show whose level this is.
    forChildId: forChild?.id || null,
    forChildName: forChild?.name || null,
    differentiatedLevel: childVariant ? (forChild?.level || activity.differentiatedLevels?.[forChild.id] || "") : "",
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
