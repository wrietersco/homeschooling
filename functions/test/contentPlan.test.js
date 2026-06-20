import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSubjectPlan, buildPlanContextString } from "../agents/contentPlan.js";

const ORDERED = [
  { id: "a1", title: "Letters Alif-Jeem", complexityRank: 1 },
  { id: "a2", title: "Joining letters", complexityRank: 2 },
];

test("sanitizeSubjectPlan keeps order and matches only real activities", () => {
  const captured = {
    coverage: "  Arabic letters then joining.  ",
    activities: [
      { activityId: "a2", objective: " Join two letters ", keyContent: "Alif+Lam" },
      { activityId: "ghost", objective: "not real" }, // dropped — no such activity
      { activityId: "a1", objective: "Recognise Alif to Jeem", buildsOn: "" },
    ],
  };
  const plan = sanitizeSubjectPlan(ORDERED, captured);
  assert.equal(plan.coverage, "Arabic letters then joining.");
  assert.deepEqual(plan.activities.map((a) => a.activityId), ["a1", "a2"]); // input order preserved
  assert.equal(plan.activities[0].objective, "Recognise Alif to Jeem");
  assert.equal(plan.activities[1].keyContent, "Alif+Lam");
});

test("sanitizeSubjectPlan tolerates missing entries (objective blank, still listed)", () => {
  const plan = sanitizeSubjectPlan(ORDERED, { activities: [] });
  assert.equal(plan.activities.length, 2);
  assert.equal(plan.activities[0].objective, "");
});

test("buildPlanContextString marks the current activity and lists the arc", () => {
  const plan = sanitizeSubjectPlan(ORDERED, {
    coverage: "Letters then joining.",
    activities: [
      { activityId: "a1", objective: "Recognise Alif-Jeem", keyContent: "Alif..Jeem" },
      { activityId: "a2", objective: "Join letters", buildsOn: "a1", keyContent: "Alif+Lam" },
    ],
  });
  const ctx = buildPlanContextString(plan, "a2");
  assert.match(ctx, /SUBJECT LEARNING PLAN/);
  assert.match(ctx, /► "Joining letters"/);     // current activity flagged
  assert.match(ctx, /Must cover EXACTLY: Alif\+Lam/);
  assert.match(ctx, /Builds on: a1/);
  // the non-current sibling is listed but NOT flagged
  assert.match(ctx, /1\. "Letters Alif-Jeem"/);
});

test("buildPlanContextString returns empty string when there is no plan", () => {
  assert.equal(buildPlanContextString(null, "a1"), "");
  assert.equal(buildPlanContextString({ activities: [] }, "a1"), "");
});
