// Outline → scenes runner for the Wikido Topic Builder. Pure orchestration with
// an injected `createScene`, so failure containment is unit-tested without
// Firebase. The real createScene is the guarded addWikidoChildScene callable:
// every scene is validated server-side and lands as a draft.
//
// Contract: breadth-first, one scene at a time; a failed node marks ONLY its own
// subtree "skipped" and the siblings carry on; the run can be stopped between
// scenes; every outcome is reported through onUpdate so the UI shows live
// per-scene status and never a blank screen.

let keySeq = 0;

// Give every outline node a stable key for the review UI (rename/remove/status).
export function withKeys(nodes) {
  return (nodes || []).map((n) => ({
    key: `n${++keySeq}`,
    label: n.label,
    focus: n.focus,
    children: withKeys(n.children),
  }));
}

export function countOutline(nodes) {
  return (nodes || []).reduce((sum, n) => sum + 1 + countOutline(n.children), 0);
}

// Returns a NEW tree without the node (and its subtree).
export function removeOutlineNode(nodes, key) {
  return (nodes || [])
    .filter((n) => n.key !== key)
    .map((n) => ({ ...n, children: removeOutlineNode(n.children, key) }));
}

// Breadth-first flat list: [{ key, label, focus, parentKey|null }]
export function flattenOutline(nodes) {
  const out = [];
  let level = (nodes || []).map((n) => ({ n, parentKey: null }));
  while (level.length) {
    const next = [];
    for (const { n, parentKey } of level) {
      out.push({ key: n.key, label: n.label, focus: n.focus, parentKey });
      for (const c of n.children || []) next.push({ n: c, parentKey: n.key });
    }
    level = next;
  }
  return out;
}

// → { items: [{ key, label, status, sceneId, error, parentKey }], created: [sceneId…], stopped }
export async function runOutline({ outline, parentSceneId, createScene, onUpdate = () => {}, shouldStop = () => false }) {
  const items = flattenOutline(outline).map((i) => ({ ...i, status: "pending", sceneId: "", error: "" }));
  const byKey = new Map(items.map((i) => [i.key, i]));
  const created = [];
  let stopped = false;
  const emit = () => onUpdate(items.map((i) => ({ ...i })));
  emit();

  for (const item of items) {
    const parent = item.parentKey ? byKey.get(item.parentKey) : null;
    if (parent && parent.status !== "done") {
      item.status = "skipped";
      emit();
      continue;
    }
    if (shouldStop()) {
      stopped = true;
      break;
    }
    item.status = "running";
    emit();
    try {
      const res = await createScene({
        parentSceneId: parent ? parent.sceneId : parentSceneId,
        label: item.label,
        focus: item.focus,
      });
      item.sceneId = res.sceneId;
      item.status = "done";
      created.push(res.sceneId);
    } catch (e) {
      item.status = "failed";
      item.error = String(e?.message || e).replace(/^(internal|invalid-argument|failed-precondition): /, "").slice(0, 200);
    }
    emit();
  }
  // anything never reached because of a stop stays "pending"
  return { items, created, stopped };
}

export function summarizeRun(items) {
  const count = (s) => items.filter((i) => i.status === s).length;
  return { done: count("done"), failed: count("failed"), skipped: count("skipped"), pending: count("pending") };
}
