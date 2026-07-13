import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUsageAlerts } from "../platform/usageDashboard.js";

const find = (alerts, re) => alerts.find((a) => re.test(a.title));

test("over the TTS daily limit → a danger alert in plain language", () => {
  const alerts = buildUsageAlerts({ todayTts: { requests: 113, quotaErrors: 13 }, ttsLimit: 100 });
  const a = find(alerts, /daily limit reached/i);
  assert.ok(a);
  assert.equal(a.level, "danger");
  assert.match(a.detail, /113 of ~100/);
});

test("any quota error today trips the limit alert even under the count", () => {
  const a = find(buildUsageAlerts({ todayTts: { requests: 40, quotaErrors: 1 }, ttsLimit: 100 }), /daily limit reached/i);
  assert.equal(a.level, "danger");
});

test("approaching the limit (>=80%) → a warning, not danger", () => {
  const alerts = buildUsageAlerts({ todayTts: { requests: 85, quotaErrors: 0 }, ttsLimit: 100 });
  assert.equal(find(alerts, /Close to/i).level, "warn");
  assert.equal(find(alerts, /daily limit reached/i), undefined);
});

test("low usage → healthy ok alert", () => {
  assert.equal(find(buildUsageAlerts({ todayTts: { requests: 5 }, ttsLimit: 100 }), /healthy/i).level, "ok");
});

test("qaida paused surfaces a clear restart hint", () => {
  const a = find(buildUsageAlerts({ todayTts: {}, qaida: { status: "paused", processed: 50, total: 449 } }), /Qaida audio is paused/i);
  assert.equal(a.level, "warn");
  assert.match(a.detail, /50 of 449/);
  assert.match(a.detail, /Restart/i);
});

test("spend card is always present and formatted as dollars", () => {
  const a = find(buildUsageAlerts({ todayTts: {}, monthCostUsd: 1.2345, monthCalls: 42 }), /spend this month/i);
  assert.match(a.detail, /\$1\.23 across 42/);
});
