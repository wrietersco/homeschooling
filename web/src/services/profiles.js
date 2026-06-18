// Guardian + child profile CRUD and family-profile editing. Writes go straight
// to Firestore (Security Rules enforce that only owner/parent in the family may
// write). familyId is supplied by callers from the auth store.
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const fam = (familyId) => ["families", familyId];

// ---- Family profile (name + guiding light + goal mode) ----
export async function saveFamilyProfile(familyId, { familyName, guidingLight, goalMode }, uid) {
  await setDoc(
    doc(db, ...fam(familyId), "profile", "family"),
    {
      familyName: familyName ?? "",
      guidingLight: guidingLight ?? "",
      goalMode: goalMode ?? "individual",
      updatedAt: serverTimestamp(),
      updatedBy: uid ?? null,
    },
    { merge: true }
  );
  if (familyName) {
    await updateDoc(doc(db, ...fam(familyId)), {
      name: familyName,
      updatedAt: serverTimestamp(),
    });
  }
}

// ---- Guardians ----
export function newGuardian() {
  return {
    name: "", dob: "", occupation: "", motherTongue: "",
    monthlyEducationBudget: "", totalIncome: "", location: "",
    cityFacilities: "", likes: "", dislikes: "", goals: "",
    memberUid: null,
  };
}
export async function addGuardian(familyId, data) {
  return addDoc(collection(db, ...fam(familyId), "guardians"), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}
export async function updateGuardian(familyId, gid, data) {
  return updateDoc(doc(db, ...fam(familyId), "guardians", gid), {
    ...data, updatedAt: serverTimestamp(),
  });
}
export async function deleteGuardian(familyId, gid) {
  return deleteDoc(doc(db, ...fam(familyId), "guardians", gid));
}

// ---- Children ----
export function newChild() {
  return { name: "", dob: "", strengths: "", weaknesses: "", goals: "", comments: "" };
}
export async function addChild(familyId, data) {
  return addDoc(collection(db, ...fam(familyId), "children"), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}
export async function updateChild(familyId, childId, data) {
  return updateDoc(doc(db, ...fam(familyId), "children", childId), {
    ...data, updatedAt: serverTimestamp(),
  });
}
export async function deleteChild(familyId, childId) {
  return deleteDoc(doc(db, ...fam(familyId), "children", childId));
}
