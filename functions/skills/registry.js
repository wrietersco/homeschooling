// Creating a new skill mirrors it to the global registry (superadmin-only by
// rules, so it must be done server-side) and adopts it into the caller's family
// in one atomic batch. Picking an existing registry skill is a plain client
// write and does not come through here.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { userRef, familyPaths } from "../lib/paths.js";

function clean(str, max) {
  return String(str || "").trim().slice(0, max);
}

export const createGlobalSkill = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const name = clean(request.data?.name, 120);
  const category = clean(request.data?.category, 80);
  if (!name) throw new HttpsError("invalid-argument", "Skill name is required.");

  const db = getFirestore();

  // Resolve + verify the caller's family and that they may write to it.
  const userSnap = await userRef(db, uid).get();
  const familyId = userSnap.exists ? userSnap.data()?.familyId : null;
  if (!familyId) throw new HttpsError("failed-precondition", "Create a family first.");
  const p = familyPaths(db, familyId);
  const memberSnap = await p.member(uid).get();
  const role = memberSnap.exists ? memberSnap.data()?.role : null;
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only an owner or parent can add skills.");
  }

  const registryRef = db.collection("skillRegistry").doc();
  const registryId = registryRef.id;
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(registryRef, {
    name,
    category,
    nameLower: name.toLowerCase(),
    createdByFamily: familyId,
    createdBy: uid,
    createdAt: now,
  });
  batch.set(p.skills().doc(registryId), {
    name,
    category,
    source: "custom",
    registryId,
    adoptedAt: now,
  });
  await batch.commit();

  return { skillId: registryId, registryId };
});
