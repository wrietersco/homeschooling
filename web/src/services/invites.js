import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

export function createInvite(email) {
  return httpsCallable(functions, "createInvite")({ email });
}

export function acceptInvite(familyId, inviteId) {
  return httpsCallable(functions, "acceptInvite")({ familyId, inviteId });
}

export async function getInvite(familyId, inviteId) {
  const snap = await getDoc(doc(db, "families", familyId, "invites", inviteId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getPendingInvites(familyId) {
  const snap = await getDocs(collection(db, "families", familyId, "invites"));
  const now = new Date();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.status === "pending" && i.expiresAt?.toDate() > now);
}
