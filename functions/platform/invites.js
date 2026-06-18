// Family invite system.
// createInvite  — owner generates a shareable link token (familyId.inviteId).
// acceptInvite  — any signed-in user with a valid pending token joins as parent.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { resolveCaller } from "../lib/caller.js";
import { userRef } from "../lib/paths.js";

export const createInvite = onCall(async (request) => {
  const { db, uid, familyId, role } = await resolveCaller(request);
  if (role !== "owner") {
    throw new HttpsError("permission-denied", "Only the family owner can invite members.");
  }

  const email = String(request.data?.email || "").trim().slice(0, 200);
  const inviteId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const profileSnap = await db
    .collection("families").doc(familyId)
    .collection("profile").doc("family").get();
  const familyName = profileSnap.exists ? (profileSnap.data().familyName || "the family") : "the family";

  const inviterAuth = await getAuth().getUser(uid);
  const invitedByName = inviterAuth.displayName || inviterAuth.email || "A family owner";

  await db
    .collection("families").doc(familyId)
    .collection("invites").doc(inviteId).set({
      email,
      role: "parent",
      status: "pending",
      invitedBy: uid,
      invitedByName,
      familyName,
      createdAt: now,
      expiresAt,
    });

  return { inviteId, token: `${familyId}.${inviteId}` };
});

export const acceptInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to accept an invite.");

  const familyId = String(request.data?.familyId || "").trim();
  const inviteId = String(request.data?.inviteId || "").trim();
  if (!familyId || !inviteId) {
    throw new HttpsError("invalid-argument", "familyId and inviteId are required.");
  }

  const db = getFirestore();
  const auth = getAuth();

  const inviteRef = db.collection("families").doc(familyId).collection("invites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError("not-found", "Invite not found.");

  const data = inviteSnap.data();
  if (data.status !== "pending") {
    throw new HttpsError("failed-precondition", "This invite has already been used.");
  }
  if (data.expiresAt.toDate() < new Date()) {
    throw new HttpsError("deadline-exceeded", "This invite has expired.");
  }

  // Block users who already belong to a family.
  const existingUser = await userRef(db, uid).get();
  if (existingUser.exists && existingUser.data()?.familyId) {
    throw new HttpsError("already-exists", "You already belong to a family.");
  }

  const authUser = await auth.getUser(uid);
  const displayName = authUser.displayName || authUser.email?.split("@")[0] || "Parent";
  const email = authUser.email || "";
  const memberRole = data.role || "parent";
  const now = new Date();

  const batch = db.batch();
  batch.set(
    db.collection("families").doc(familyId).collection("members").doc(uid),
    { role: memberRole, email, displayName, joinedAt: now }
  );
  batch.set(userRef(db, uid), { familyId, role: memberRole, email, displayName, createdAt: now });
  batch.update(inviteRef, { status: "accepted", acceptedBy: uid, acceptedAt: now });
  await batch.commit();

  // Update custom claims so security rules reflect membership on next token refresh.
  const existing = (await auth.getUser(uid)).customClaims || {};
  await auth.setCustomUserClaims(uid, { ...existing, familyId, role: memberRole });

  return { familyId, role: memberRole, familyName: data.familyName };
});
