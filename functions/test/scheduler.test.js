import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeScheduleHistory, weeklyRepeatTarget, describeMaterialForPool, placementKey,
  timeToMinutes, normalizeGuardianAvailability, evaluatePlacement, availabilityWindowsByDate,
  resolveGuardianId,
} from "../agents/scheduler.js";

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

test("weeklyRepeatTarget: daily memorisation repeats ~5×/week, others once", () => {
  assert.equal(weeklyRepeatTarget({ repeatable: true, repeatFrequency: "daily" }), 5);
  assert.equal(weeklyRepeatTarget({ repeatable: true, repeatFrequency: "weekly" }), 1);
  assert.equal(weeklyRepeatTarget({ repeatable: true, repeatFrequency: "biweekly" }), 1);
  assert.equal(weeklyRepeatTarget({ repeatable: true, repeatFrequency: "monthly" }), 1);
  // Not repeatable, or missing material → placed once.
  assert.equal(weeklyRepeatTarget({ repeatable: false, repeatFrequency: "daily" }), 1);
  assert.equal(weeklyRepeatTarget(null), 1);
  assert.equal(weeklyRepeatTarget(undefined), 1);
});

test("placementKey: dedup is per activity+day+child, so it catches same-day repeats only", () => {
  const a = "act1";
  // The exact same placement (same activity, same day, group/no child) collides —
  // this is the duplicate the guard rejects.
  assert.equal(placementKey(a, "2026-06-22", ""), placementKey(a, "2026-06-22", undefined));
  // A repeat on a DIFFERENT day is a different key (allowed — repeats span days).
  assert.notEqual(placementKey(a, "2026-06-22", ""), placementKey(a, "2026-06-23", ""));
  // Same activity + day but a different child is a different key (per-child blocks).
  assert.notEqual(placementKey(a, "2026-06-22", "child1"), placementKey(a, "2026-06-22", "child2"));
  // A per-child block and the group block on the same day do not collide.
  assert.notEqual(placementKey(a, "2026-06-22", "child1"), placementKey(a, "2026-06-22", ""));
  // Different activities never collide.
  assert.notEqual(placementKey("act1", "2026-06-22", ""), placementKey("act2", "2026-06-22", ""));
});

test("placementKey: a duplicate placement is detected against a seeded set", () => {
  const seen = new Set();
  const place = (id, day, child) => {
    const k = placementKey(id, day, child);
    if (seen.has(k)) return false; // rejected as duplicate
    seen.add(k);
    return true;
  };
  assert.equal(place("act1", "2026-06-22", ""), true);  // first time → placed
  assert.equal(place("act1", "2026-06-22", ""), false); // exact repeat → rejected
  assert.equal(place("act1", "2026-06-23", ""), true);  // next day → placed
  assert.equal(place("act1", "2026-06-22", "kidA"), true); // per-child same day → placed
  assert.equal(place("act1", "2026-06-22", "kidA"), false); // per-child repeat → rejected
});

// ─── Availability enforcement ────────────────────────────────────────────────
// Mon-Sun week mirroring the planner screenshot. 2026-06-22 is a Monday.
const MON = "2026-06-22", SAT = "2026-06-27", SUN = "2026-06-28";
const WEEK_MS = [MON, "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", SAT, SUN];
// Hassan: Mon-Sat 20:00-21:00; Rabiya: Mon-Sat 16:00-18:00; neither on Sunday.
const weekdays = (s, e) => ({ mon: [{ start: s, end: e }], tue: [{ start: s, end: e }], wed: [{ start: s, end: e }],
  thu: [{ start: s, end: e }], fri: [{ start: s, end: e }], sat: [{ start: s, end: e }], sun: [] });
const GUARDS = [
  { id: "hassan", name: "Hassan", availability: weekdays("20:00", "21:00") },
  { id: "rabiya", name: "Rabiya", availability: weekdays("16:00", "18:00") },
];

test("timeToMinutes parses 24h times and rejects garbage", () => {
  assert.equal(timeToMinutes("16:00"), 960);
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(timeToMinutes("8:05"), 485);
  assert.equal(timeToMinutes("24:00"), null);
  assert.equal(timeToMinutes("9pm"), null);
  assert.equal(timeToMinutes(""), null);
});

test("normalizeGuardianAvailability: null when nothing is set, drops bad spans", () => {
  assert.equal(normalizeGuardianAvailability(null), null);
  assert.equal(normalizeGuardianAvailability({ mon: [], sun: [] }), null); // all empty → unconstrained
  const n = normalizeGuardianAvailability(weekdays("16:00", "18:00"));
  assert.deepEqual(n.mon, [{ s: 960, e: 1080 }]);
  assert.deepEqual(n.sun, []);
  // Zero/negative-length and malformed spans are dropped.
  assert.equal(normalizeGuardianAvailability({ mon: [{ start: "10:00", end: "10:00" }] }), null);
});

test("evaluatePlacement: rejects Sunday (no guardian) and out-of-window times, allows valid slots", () => {
  // Sunday — neither guardian available → rejected regardless of time.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: SUN, scheduledTime: "16:00" }).ok, false);
  assert.match(evaluatePlacement({ guardians: GUARDS, dateKey: SUN, scheduledTime: "16:00" }).reason, /Sunday/);
  // Monday 09:00 — outside both windows → rejected, reason lists the open windows.
  const r = evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "09:00" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /16:00-18:00/);
  assert.match(r.reason, /20:00-21:00/);
  // Monday 16:30 — inside Rabiya's window → allowed.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:30" }).ok, true);
  // Monday 20:30 — inside Hassan's window → allowed.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "20:30" }).ok, true);
  // Window end is exclusive: 18:00 is not inside 16:00-18:00 (and not in Hassan's) → rejected.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "18:00" }).ok, false);
});

test("evaluatePlacement: a named guardianId is checked against THAT guardian only", () => {
  // 16:30 fits Rabiya but not Hassan, so pinning Hassan rejects it.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:30", guardianId: "hassan" }).ok, false);
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:30", guardianId: "rabiya" }).ok, true);
});

test("resolveGuardianId: matches by id or name (case-insensitive), null when unknown", () => {
  assert.equal(resolveGuardianId(GUARDS, "rabiya"), "rabiya");   // by id
  assert.equal(resolveGuardianId(GUARDS, "Rabiya"), "rabiya");   // by name → canonical id
  assert.equal(resolveGuardianId(GUARDS, "  hassan  "), "hassan"); // trimmed id
  assert.equal(resolveGuardianId(GUARDS, "Nobody"), null);       // no match
  assert.equal(resolveGuardianId(GUARDS, ""), null);
  assert.equal(resolveGuardianId(GUARDS, undefined), null);
});

test("evaluatePlacement: guardianId given as a NAME resolves to that guardian (OpenAI bug fix)", () => {
  // The model only sees guardian NAMES in the prompt, so it passes the name as
  // guardianId. 16:00 is inside Rabiya's window → must be allowed, not rejected.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:00", guardianId: "Rabiya" }).ok, true);
  // A name pinned to the wrong window is still enforced: 16:30 doesn't fit Hassan.
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:30", guardianId: "Hassan" }).ok, false);
});

test("evaluatePlacement: an unrecognizable guardianId is ignored, not a hard reject", () => {
  // A bogus guardianId must not reject a slot some real guardian can cover —
  // otherwise every placement fails and nothing schedules (the 0-scheduled bug).
  assert.equal(evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "16:30", guardianId: "ghost" }).ok, true);
  // It still enforces the windows: 09:00 fits nobody → rejected with a helpful reason.
  const r = evaluatePlacement({ guardians: GUARDS, dateKey: MON, scheduledTime: "09:00", guardianId: "ghost" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no guardian is/i);
});

test("evaluatePlacement: no enforcement when no guardian has availability set", () => {
  const flex = [{ id: "x", name: "X" }, { id: "y", name: "Y", availability: { mon: [] } }];
  assert.equal(evaluatePlacement({ guardians: flex, dateKey: SUN, scheduledTime: "03:00" }).ok, true);
  // A flexible guardian alongside a constrained one can still cover any slot.
  const mixed = [{ id: "flex", name: "Flex" }, ...GUARDS];
  assert.equal(evaluatePlacement({ guardians: mixed, dateKey: SUN, scheduledTime: "09:00" }).ok, true);
});

test("availabilityWindowsByDate: flags fully-unavailable days as leave-empty", () => {
  const rows = availabilityWindowsByDate(GUARDS, WEEK_MS);
  const mon = rows.find((r) => r.dateKey === MON);
  assert.equal(mon.available, true);
  assert.match(mon.label, /Hassan 20:00-21:00/);
  assert.match(mon.label, /Rabiya 16:00-18:00/);
  const sun = rows.find((r) => r.dateKey === SUN);
  assert.equal(sun.available, false);
  assert.match(sun.label, /NO GUARDIAN AVAILABLE/);
  // Unconstrained family → every day is open.
  const open = availabilityWindowsByDate([{ id: "x", name: "X" }], WEEK_MS);
  assert.ok(open.every((r) => r.available));
});

test("describeMaterialForPool: surfaces repeat cadence + individual/shared pacing", () => {
  assert.equal(
    describeMaterialForPool({ repeatable: true, repeatFrequency: "daily", targetingMode: "individual" }),
    " · repeat daily (aim ~5×/week) · individual — one session per child",
  );
  assert.equal(
    describeMaterialForPool({ repeatable: false, targetingMode: "shared" }),
    " · shared — one slot for the group",
  );
  // No meta / blank targeting → no suffix at all (clean line).
  assert.equal(describeMaterialForPool(null), "");
  assert.equal(describeMaterialForPool({ repeatable: false, targetingMode: "" }), "");
});
