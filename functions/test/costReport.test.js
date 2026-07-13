import { test } from "node:test";
import assert from "node:assert/strict";
import { trailingMonths, currentMonth, buildFamilyTable } from "../platform/costReport.js";

test("trailingMonths returns N UTC months oldest→newest ending at now", () => {
  const months = trailingMonths(new Date("2026-03-15T12:00:00Z"), 6);
  assert.deepEqual(months, ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
});

test("trailingMonths crosses a year boundary correctly", () => {
  const months = trailingMonths(new Date("2026-01-05T00:00:00Z"), 3);
  assert.deepEqual(months, ["2025-11", "2025-12", "2026-01"]);
});

test("currentMonth is the UTC YYYY-MM", () => {
  assert.equal(currentMonth(new Date("2026-06-21T23:59:00Z")), "2026-06");
});

test("buildFamilyTable joins names and sorts by spend desc", () => {
  const byFamily = {
    famA: { costUsd: 0.5, calls: 10 },
    famB: { costUsd: 2.0, calls: 4 },
    famC: { costUsd: 0.1, calls: 1 },
  };
  const table = buildFamilyTable(byFamily, { famA: "Ahmed", famB: "Bilal" });
  assert.deepEqual(table, [
    { familyId: "famB", name: "Bilal", costUsd: 2.0, calls: 4 },
    { familyId: "famA", name: "Ahmed", costUsd: 0.5, calls: 10 },
    { familyId: "famC", name: "(unknown)", costUsd: 0.1, calls: 1 },
  ]);
});

test("buildFamilyTable is empty-safe", () => {
  assert.deepEqual(buildFamilyTable(undefined, {}), []);
});
