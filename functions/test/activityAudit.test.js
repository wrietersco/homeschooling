import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyActivity, summarizeAudit, SKILL_PACED_TYPES } from "../platform/activityAudit.js";

test("skill-paced activity targeting multiple children is flagged clubbed → split", () => {
  const r = classifyActivity({ type: "noorani_qaida", coopMode: false, targetChildren: ["hadi", "ibrahim"] });
  assert.equal(r.paced, "individual");
  assert.equal(r.clubbed, true);
  assert.equal(r.recommendation, "split-per-child");
  assert.equal(r.contentKind, "qaida_exercise");
});

test("skill-paced activity for a single child is fine — no change", () => {
  const r = classifyActivity({ type: "mathematics", coopMode: false, targetChildren: ["hadi"] });
  assert.equal(r.paced, "individual");
  assert.equal(r.clubbed, false);
  assert.equal(r.recommendation, "keep-shared");
});

test("teaching activity for both children is shared by design, never clubbed", () => {
  // The user's case: a parent-led teaching session that may COVER qaida but
  // legitimately addresses both children at once must NOT be split.
  const r = classifyActivity({ type: "teaching", coopMode: false, targetChildren: ["hadi", "ibrahim"] });
  assert.equal(r.paced, "shared");
  assert.equal(r.clubbed, false);
  assert.equal(r.recommendation, "keep-shared");
});

test("conversation (format) for multiple children stays shared", () => {
  const r = classifyActivity({ type: "conversation", coopMode: false, targetChildren: ["a", "b"] });
  assert.equal(r.clubbed, false);
});

test("skill-paced + co-op + multiple children is surfaced for review, not auto-split", () => {
  const r = classifyActivity({ type: "quran", coopMode: true, targetChildren: ["a", "b"] });
  assert.equal(r.paced, "shared"); // co-op overrides individual pacing
  assert.equal(r.clubbed, false);
  assert.equal(r.recommendation, "review-coop");
});

test("missing/garbage fields default safely to a shared teaching activity", () => {
  const r = classifyActivity({});
  assert.equal(r.type, "teaching");
  assert.equal(r.paced, "shared");
  assert.equal(r.clubbed, false);
  assert.equal(r.targetCount, 0);
});

test("summarizeAudit counts the actionable buckets", () => {
  const reports = [
    classifyActivity({ type: "noorani_qaida", targetChildren: ["a", "b"] }), // clubbed/split
    classifyActivity({ type: "arabic_reading", targetChildren: ["a", "b"] }), // clubbed/split
    classifyActivity({ type: "quran", coopMode: true, targetChildren: ["a", "b"] }), // review
    classifyActivity({ type: "teaching", targetChildren: ["a", "b"] }), // shared
    classifyActivity({ type: "mathematics", targetChildren: ["a"] }), // individual single
  ];
  const s = summarizeAudit(reports);
  assert.equal(s.total, 5);
  assert.equal(s.toSplit, 2);
  assert.equal(s.toReview, 1);
  assert.equal(s.clubbed, 2);
  assert.equal(s.individualPaced, 3); // 2 clubbed + 1 single (co-op quran is shared)
});

test("SKILL_PACED_TYPES excludes format/group types", () => {
  for (const t of ["teaching", "conversation", "physical", "computer", "ai_robotics"]) {
    assert.equal(SKILL_PACED_TYPES.has(t), false, `${t} should not be skill-paced`);
  }
  for (const t of ["quran", "noorani_qaida", "arabic_reading", "urdu_reading", "english_reading", "mathematics"]) {
    assert.equal(SKILL_PACED_TYPES.has(t), true, `${t} should be skill-paced`);
  }
});
