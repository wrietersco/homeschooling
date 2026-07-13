import { test } from "node:test";
import assert from "node:assert/strict";
import { currentDateContext, withCurrentDate } from "../lib/dateContext.js";

const FIXED = new Date("2026-06-22T09:30:00Z");

test("currentDateContext states the date in human + ISO UTC form", () => {
  const line = currentDateContext(FIXED);
  assert.match(line, /CURRENT DATE:/);
  assert.match(line, /Monday/);            // 2026-06-22 is a Monday
  assert.match(line, /June 22, 2026/);
  assert.match(line, /2026-06-22, UTC/);
});

test("withCurrentDate prepends the date line above an existing prompt", () => {
  const out = withCurrentDate("You are a guide.", FIXED);
  assert.ok(out.startsWith("CURRENT DATE:"), "date line must come first");
  assert.match(out, /You are a guide\./);
  // The original prompt is preserved verbatim after the date block.
  assert.ok(out.endsWith("You are a guide."));
});

test("withCurrentDate is safe with empty/undefined system", () => {
  assert.equal(withCurrentDate("", FIXED), currentDateContext(FIXED));
  assert.equal(withCurrentDate(undefined, FIXED), currentDateContext(FIXED));
});

test("defaults to the real current date when no clock is injected", () => {
  const line = currentDateContext();
  assert.match(line, /CURRENT DATE: Today is .+ \(\d{4}-\d{2}-\d{2}, UTC\)/);
});
