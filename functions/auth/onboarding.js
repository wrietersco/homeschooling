// Family onboarding. The first time a signed-in user creates a family they
// become its owner. This runs with the Admin SDK (bypassing Security Rules), so
// family/member/profile creation is server-controlled — clients can never mint
// a family or grant themselves membership directly.
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { familyPaths, userRef } from "../lib/paths.js";

function clean(str, max) {
  return String(str || "").trim().slice(0, max);
}

export const createFamily = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to create a family.");

  const familyName = clean(request.data?.familyName, 120);
  const guidingLight = clean(request.data?.guidingLight, 4000);
  if (!familyName) throw new HttpsError("invalid-argument", "Family name is required.");

  const db = getFirestore();

  // One family per user for now: block if they already belong to one.
  const userSnap = await userRef(db, uid).get();
  if (userSnap.exists && userSnap.data()?.familyId) {
    throw new HttpsError("already-exists", "You already belong to a family.");
  }

  const email = request.auth.token?.email || null;
  // Prefer the client-supplied name: a freshly-registered user's ID token may
  // not yet carry the displayName set via updateProfile().
  const displayName =
    clean(request.data?.displayName, 120) ||
    clean(request.auth.token?.name, 120) ||
    (email ? email.split("@")[0] : "Owner");

  const familyRef = db.collection("families").doc();
  const familyId = familyRef.id;
  const p = familyPaths(db, familyId);
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(familyRef, {
    name: familyName,
    ownerUid: uid,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  batch.set(p.member(uid), {
    role: "owner",
    email,
    displayName,
    joinedAt: now,
  });
  batch.set(p.profile(), {
    familyName,
    guidingLight,
    goalMode: "individual",
    updatedAt: now,
    updatedBy: uid,
  });
  batch.set(p.meta(), {
    seeded: false,
    timezone: clean(request.data?.timezone, 64) || "Asia/Karachi",
    createdAt: now,
  });
  batch.set(userRef(db, uid), {
    familyId,
    role: "owner",
    email,
    displayName,
    createdAt: now,
  });
  await batch.commit();

  // Forward-looking custom claims (preserve any platformRole already set).
  const existing = (await getAuth().getUser(uid)).customClaims || {};
  await getAuth().setCustomUserClaims(uid, { ...existing, familyId, role: "owner" });

  return { familyId, role: "owner" };
});
