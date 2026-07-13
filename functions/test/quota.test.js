import { test } from "node:test";
import assert from "node:assert/strict";
import { platformBudget, familyBudget, allocate, DEFAULT_QUOTA } from "../platform/quota.js";

test("platform reserve is the configured % of the model's RPD", () => {
  assert.equal(platformBudget(100, 30), 30);
  assert.equal(platformBudget(100, 0), 0);
  assert.equal(platformBudget(50, 30), 15);
  assert.equal(platformBudget(100, 200), 100); // clamped to 100%
});

test("families split the remaining pool EQUALLY by default", () => {
  // 100 RPD, 30% reserve ⇒ 70 for families. 5 families ⇒ 14 each.
  const ids = ["a", "b", "c", "d", "e"];
  for (const id of ids) assert.equal(familyBudget(100, 30, id, ids), 14);
});

test("weights shift allocation between families", () => {
  // pool = 70. weights a:3, b:1, c:1 ⇒ total 5 ⇒ a=42, b=14, c=14.
  const ids = ["a", "b", "c"];
  const w = { a: 3 };
  assert.equal(familyBudget(100, 30, "a", ids, w), 42);
  assert.equal(familyBudget(100, 30, "b", ids, w), 14);
  assert.equal(familyBudget(100, 30, "c", ids, w), 14);
});

test("a single family gets the whole families pool", () => {
  assert.equal(familyBudget(100, 30, "solo", ["solo"]), 70);
});

test("zero families ⇒ no family budget, reserve still computed", () => {
  const { platform, families } = allocate(DEFAULT_QUOTA, []);
  assert.equal(platform["gemini-2.5-flash-preview-tts"], 30);
  assert.deepEqual(families, {});
});

test("allocate covers every model for every family", () => {
  const { platform, families } = allocate(DEFAULT_QUOTA, ["f1", "f2"]);
  assert.equal(platform["gemini-2.5-flash-preview-tts"], 30);
  assert.equal(platform["gemini-2.5-pro-preview-tts"], 15);
  // 70 / 2 = 35 each for flash-tts; (50-15)=35 /2 = 17 each for pro-tts.
  assert.equal(families.f1["gemini-2.5-flash-preview-tts"], 35);
  assert.equal(families.f2["gemini-2.5-pro-preview-tts"], 17);
});

test("platform reserve + sum of family budgets never exceeds the pool", () => {
  const ids = ["a", "b", "c"]; // 70 pool, /3 = 23 each ⇒ 69, +30 reserve = 99 ≤ 100
  const reserve = platformBudget(100, 30);
  const famSum = ids.reduce((s, id) => s + familyBudget(100, 30, id, ids), 0);
  assert.ok(reserve + famSum <= 100, `${reserve}+${famSum} > 100`);
});
