// Firestore write helpers for the Activity Planner.
// Blocks live at families/{id}/calendarDays/{YYYY-MM-DD}/blocks/{blockId}.
import { collection, addDoc, deleteDoc, updateDoc, doc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";

function blocksRef(familyId, dateKey) {
  return collection(db, "families", familyId, "calendarDays", dateKey, "blocks");
}

export function addBlock(familyId, dateKey, block) {
  return addDoc(blocksRef(familyId, dateKey), { ...block, createdAt: new Date() });
}

export function removeBlock(familyId, dateKey, blockId) {
  return deleteDoc(doc(db, "families", familyId, "calendarDays", dateKey, "blocks", blockId));
}

export function updateBlock(familyId, dateKey, blockId, updates) {
  return updateDoc(
    doc(db, "families", familyId, "calendarDays", dateKey, "blocks", blockId),
    updates
  );
}

// Delete every block across the given days (one week). Returns the count
// removed so callers can confirm to the user. Batches are chunked to stay
// under Firestore's 500-op limit.
export async function clearBlocks(familyId, dateKeys) {
  const refs = [];
  await Promise.all(
    dateKeys.map(async (dateKey) => {
      const snap = await getDocs(blocksRef(familyId, dateKey));
      snap.forEach((d) => refs.push(d.ref));
    })
  );
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}
