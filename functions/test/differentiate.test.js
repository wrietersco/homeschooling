import { test } from "node:test";
import assert from "node:assert/strict";
import { isDifferentiationCandidate } from "../platform/differentiate.js";

// A clubbed activity: skill-paced (noorani_qaida), not co-op, two children, no
// per-child content yet → the audit flags it, so it's a candidate.
const CLUBBED_QAIDA = { type: "noorani_qaida", coopMode: false, targetChildren: ["hadi", "ibrahim"] };

test("selects a clubbed skill-paced activity (no type filter)", () => {
  assert.equal(isDifferentiationCandidate(CLUBBED_QAIDA, new Set()), true);
});

test("respects a type filter — narrows to requested types", () => {
  assert.equal(isDifferentiationCandidate(CLUBBED_QAIDA, new Set(["noorani_qaida"])), true);
  assert.equal(isDifferentiationCandidate(CLUBBED_QAIDA, new Set(["mathematics"])), false);
});

test("skips an activity that already has per-child content", () => {
  assert.equal(isDifferentiationCandidate({ ...CLUBBED_QAIDA, contentByChild: { hadi: {} } }, new Set()), false);
});

test("skips a single-child activity (nothing to differentiate)", () => {
  assert.equal(isDifferentiationCandidate({ ...CLUBBED_QAIDA, targetChildren: ["hadi"] }, new Set()), false);
});

test("skips a shared/format activity the heuristic keeps together", () => {
  // teaching is not skill-paced → not clubbed under the heuristic.
  assert.equal(isDifferentiationCandidate({ type: "teaching", targetChildren: ["a", "b"] }, new Set()), false);
});

test("generalises beyond qaida via the content plan's targetingMode 'individual'", () => {
  // A teaching activity the type heuristic would keep shared, but the content plan
  // marked individually paced → now a differentiation candidate, no type filter.
  const planMarkedIndividual = {
    type: "teaching",
    targetChildren: ["a", "b"],
    plan: { material: { targetingMode: "individual" } },
  };
  assert.equal(isDifferentiationCandidate(planMarkedIndividual, new Set()), true);
});

test("targetingMode 'shared' keeps a skill-paced activity out of the candidate set", () => {
  const planMarkedShared = { ...CLUBBED_QAIDA, plan: { material: { targetingMode: "shared" } } };
  assert.equal(isDifferentiationCandidate(planMarkedShared, new Set()), false);
});

test("accepts a plain array for typeSet and is null-safe", () => {
  assert.equal(isDifferentiationCandidate(CLUBBED_QAIDA, ["noorani_qaida"]), true);
  assert.equal(isDifferentiationCandidate(CLUBBED_QAIDA, null), true);
  assert.equal(isDifferentiationCandidate(null, new Set()), false);
});
