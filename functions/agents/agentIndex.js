// Agent DB index maintenance. For each tracked collection we keep a pointer doc
// at families/{familyId}/_agent_index/{collection} = { count, fields, sampleIds,
// updatedAt }. Agents call list_collections to orient themselves cheaply instead
// of scanning. Counts are kept live by Firestore triggers (create:+1, delete:-1)
// and field-name hints are refreshed from each written doc.
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Collections worth indexing for agent orientation.
export const TRACKED_COLLECTIONS = [
  "children", "guardians", "skills", "curriculum",
  "activities", "observations", "scores",
];

// Reconcile the cached _agent_index counts against ground truth for one family
// (audit #15). Trigger-maintained increments can drift over time (at-least-once
// delivery, partial failures); this recomputes the true count per tracked
// collection with an aggregation query and overwrites it. Best-effort per
// collection. Returns a map of { collection: count }.
export async function reconcileFamilyIndex(db, familyId) {
  const out = {};
  for (const collection of TRACKED_COLLECTIONS) {
    try {
      const agg = await db
        .collection("families").doc(familyId)
        .collection(collection).count().get();
      const count = agg.data().count;
      await db
        .collection("families").doc(familyId)
        .collection("_agent_index").doc(collection)
        .set({ collection, count, reconciledAt: new Date() }, { merge: true });
      out[collection] = count;
    } catch (e) {
      console.warn(`[agentIndex] reconcile ${familyId}/${collection} failed: ${e?.message || e}`);
    }
  }
  return out;
}

// Build one trigger per tracked collection. Exported and spread into index.js.
export function buildIndexTriggers() {
  const triggers = {};
  for (const collection of TRACKED_COLLECTIONS) {
    const exportName = `idx_${collection}`;
    triggers[exportName] = onDocumentWritten(
      `families/{familyId}/${collection}/{docId}`,
      async (event) => {
        const { familyId } = event.params;
        const before = event.data?.before;
        const after = event.data?.after;
        const created = (!before || !before.exists) && after && after.exists;
        const deleted = before && before.exists && (!after || !after.exists);

        const db = getFirestore();
        const ref = db
          .collection("families").doc(familyId)
          .collection("_agent_index").doc(collection);

        const patch = { collection, updatedAt: new Date() };
        if (created) patch.count = FieldValue.increment(1);
        if (deleted) patch.count = FieldValue.increment(-1);
        if (after && after.exists) {
          // Track the union of field names seen (schema hint for the agent).
          patch.fields = FieldValue.arrayUnion(...Object.keys(after.data() || {}));
        }
        await ref.set(patch, { merge: true });
      }
    );
  }
  return triggers;
}
