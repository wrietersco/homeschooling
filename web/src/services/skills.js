// Skills service. A family adopts skills either from the global registry or by
// creating a new one. Creating a NEW global skill writes to the superadmin-only
// registry, so it goes through the createGlobalSkill callable (Admin SDK).
// Adopting an existing registry skill and binding skills to children are plain
// client writes (allowed for owner/parent by Security Rules).
import {
  collection, doc, setDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

const fam = (familyId) => ["families", familyId];

// Create a brand-new skill: mirrored to the global registry + adopted by the
// family. Returns { skillId, registryId }.
export async function createGlobalSkill({ name, category }) {
  const call = httpsCallable(functions, "createGlobalSkill");
  const res = await call({ name, category });
  return res.data;
}

// Adopt an existing registry skill into the family (idempotent on registryId).
export async function adoptRegistrySkill(familyId, registrySkill) {
  await setDoc(doc(db, ...fam(familyId), "skills", registrySkill.id), {
    name: registrySkill.name,
    category: registrySkill.category ?? "",
    source: "registry",
    registryId: registrySkill.id,
    adoptedAt: serverTimestamp(),
  });
}

export async function removeFamilySkill(familyId, skillId) {
  await deleteDoc(doc(db, ...fam(familyId), "skills", skillId));
}

// Bind / unbind a skill to a specific child (per-child tracking).
export async function bindSkillToChild(familyId, childId, skill) {
  await setDoc(doc(db, ...fam(familyId), "children", childId, "skills", skill.id), {
    skillId: skill.id,
    name: skill.name,
    category: skill.category ?? "",
    status: "active",
    boundAt: serverTimestamp(),
  });
}
export async function unbindSkillFromChild(familyId, childId, skillId) {
  await deleteDoc(doc(db, ...fam(familyId), "children", childId, "skills", skillId));
}

// Kick off the server-side skill-mapping agent. Runs inline (the promise resolves
// when the whole map is built), but writes live progress to agentRuns as it goes,
// so the caller subscribes to the latest skillmap run for a live picture.
export async function requestSkillMap() {
  const call = httpsCallable(functions, "requestSkillMap", { timeout: 540000 });
  const res = await call({});
  return res.data;
}
