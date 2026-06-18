// Firestore write helpers for the Activity Planner.
// Blocks live at families/{id}/calendarDays/{YYYY-MM-DD}/blocks/{blockId}.
import { collection, addDoc, deleteDoc, updateDoc, doc } from "firebase/firestore";
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
