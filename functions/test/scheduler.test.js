import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeScheduleHistory } from "../agents/scheduler.js";

const WEEK = [
  "2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24",
  "2026-06-25", "2026-06-26", "2026-06-27",
];

test("counts repeats and splits past vs current-week placements", () => {
  const days = [
    { date: "2026-06-10", blocks: [{ activityId: "a1", title: "Alif", time: "09:00", rank: 1 }] },
    { date: "2026-06-17", blocks: [
      { activityId: "a1", title: "Alif", time: "09:00", rank: 1 },
      { activityId: "a2", title: "Counting", time: "10:00", rank: 2 },
    ] },
    { date: "2026-06-22", blocks: [{ activityId: "a3", title: "Story", time: "09:30", rank: 2 }] }, // inside target week
  ];
  const { counts, pastLines, weekLines } = summarizeScheduleHistory(days, WEEK);

  assert.equal(counts.get("a1"), 2); // placed in two earlier weeks
  assert.equal(counts.get("a2"), 1);
  assert.equal(counts.get("a3"), 1);

  assert.equal(pastLines.length, 2); // the two non-week days
  assert.equal(weekLines.length, 1); // the one day inside the target week
  assert.match(weekLines[0], /Story/);
  assert.match(weekLines[0], /2026-06-22/);
});

test("annotates each line with the weekday and is empty-safe", () => {
  const { counts, pastLines, weekLines } = summarizeScheduleHistory([], WEEK);
  assert.equal(counts.size, 0);
  assert.equal(pastLines.length, 0);
  assert.equal(weekLines.length, 0);

  const one = summarizeScheduleHistory(
    [{ date: "2026-06-10", blocks: [{ activityId: "a1", title: "Alif", time: "09:00", rank: 1 }] }],
    WEEK,
  );
  assert.match(one.pastLines[0], /Wednesday/); // 2026-06-10 is a Wednesday
});

test("blocks with no activityId do not pollute the counts", () => {
  const days = [{ date: "2026-06-10", blocks: [{ title: "Free play", time: "11:00" }] }];
  const { counts, pastLines } = summarizeScheduleHistory(days, WEEK);
  assert.equal(counts.size, 0);
  assert.equal(pastLines.length, 1); // still listed for context
});
