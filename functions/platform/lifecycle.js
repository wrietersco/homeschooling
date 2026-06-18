// Lifecycle (destructive) callables that BOTH family admins and the superadmin
// can invoke:
//   deleteCurriculum — removes a curriculum plan + its subjects.
//   deleteSyllabus   — removes generated activities (the "syllabus") and any
//                      calendar blocks that referenced them.
//
// Permissions: a family owner/parent acts on their own family (familyId derived
// from their verified token). A platform superadmin may target any family by
// passing an explicit familyId.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveCaller } from "../lib/caller.js";
import { familyPaths } from "../lib/paths.js";

// Resolve { db, familyId } honouring the dual caller model above.
async function resolveTarget(request) {
  const isSuper = request.auth?.token?.platformRole === "superadmin";
  const explicitFamilyId = request.data?.familyId ? String(request.data.familyId) : null;

  if (isSuper && explicitFamilyId) {
    return { db: getFirestore(), familyId: explicitFamilyId };
  }
  const { db, familyId, role } = await resolveCaller(request);
  if (!["owner", "parent"].includes(role)) {
    throw new HttpsError("permission-denied", "Only family owners or parents can delete curriculum or syllabus.");
  }
  return { db, familyId };
}

// Commit deletes in chunks (Firestore batch limit is 500).
async function deleteRefsInChunks(db, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}

// ── Delete a curriculum (and its subjects subcollection) ──────────────────────
export const deleteCurriculum = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { db, familyId } = await resolveTarget(request);
  const curriculumId = String(request.data?.curriculumId || "").trim();
  if (!curriculumId) throw new HttpsError("invalid-argument", "curriculumId is required.");

  const ref = familyPaths(db, familyId).curriculum().doc(curriculumId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Curriculum not found.");
  await db.recursiveDelete(ref); // handles the subjects subcollection
  return { ok: true };
});

// ── Delete the generated syllabus (activities + referencing calendar blocks) ──
// Optionally scoped to one curriculumId; otherwise clears all activities.
export const deleteSyllabus = onCall({ timeoutSeconds: 300 }, async (request) => {
  const { db, familyId } = await resolveTarget(request);
  const curriculumId = String(request.data?.curriculumId || "").trim();
  const p = familyPaths(db, familyId);

  let query = p.activities();
  if (curriculumId) query = query.where("curriculumId", "==", curriculumId);
  const actSnap = await query.get();
  if (actSnap.empty) return { ok: true, activitiesDeleted: 0, blocksDeleted: 0 };

  const deletedIds = new Set(actSnap.docs.map((d) => d.id));
  await deleteRefsInChunks(db, actSnap.docs.map((d) => d.ref));

  // Remove calendar blocks that pointed at the now-deleted activities so the
  // planner/player don't show dangling entries.
  let blocksDeleted = 0;
  const daysSnap = await p.calendarDays().get();
  for (const day of daysSnap.docs) {
    const blocksSnap = await day.ref.collection("blocks").get();
    const stale = blocksSnap.docs.filter((b) => deletedIds.has(b.data().activityId));
    if (stale.length) {
      await deleteRefsInChunks(db, stale.map((b) => b.ref));
      blocksDeleted += stale.length;
    }
  }

  return { ok: true, activitiesDeleted: deletedIds.size, blocksDeleted };
});
