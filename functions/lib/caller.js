// Resolve the calling user's family + role from a verified callable request.
// Tenant scoping for every agent/CRUD action derives from this — never from
// client-supplied familyId.
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { userRef, familyPaths } from "./paths.js";

export async function resolveCaller(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const db = getFirestore();
  const userSnap = await userRef(db, uid).get();
  const familyId = userSnap.exists ? userSnap.data()?.familyId : null;
  if (!familyId) throw new HttpsError("failed-precondition", "Create a family first.");

  const memberSnap = await familyPaths(db, familyId).member(uid).get();
  const role = memberSnap.exists ? memberSnap.data()?.role : null;
  if (!role) throw new HttpsError("permission-denied", "You are not a member of this family.");

  // Enforce family suspension server-side (audit #5). A superadmin can still act
  // on a disabled family via the lifecycle/admin callables (which bypass this).
  const famSnap = await db.collection("families").doc(familyId).get();
  if (famSnap.exists && famSnap.data()?.status === "disabled") {
    throw new HttpsError("permission-denied", "This family is currently disabled. Contact support.");
  }

  return { db, uid, familyId, role };
}
