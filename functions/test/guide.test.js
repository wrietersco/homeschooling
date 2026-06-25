import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrentUser, historyToContents } from "../agents/guide.js";

test("formatCurrentUser prefers the guardian name and folds in detail", () => {
  const out = formatCurrentUser({
    member: { role: "owner", email: "amina@example.com", displayName: "A." },
    guardian: { name: "Amina", relationship: "mother", motherTongue: "Urdu" },
  });
  assert.match(out, /CURRENT USER/);
  assert.match(out, /Amina/);
  assert.match(out, /mother/);
  assert.match(out, /owner account/);
  assert.match(out, /mother tongue Urdu/);
});

test("formatCurrentUser falls back to member identity when no guardian is bound", () => {
  const out = formatCurrentUser({ member: { role: "parent", email: "dad@example.com" }, guardian: null });
  assert.match(out, /dad@example.com/);
  assert.match(out, /parent account/);
});

test("formatCurrentUser is safe with empty input", () => {
  const out = formatCurrentUser({});
  assert.match(out, /this guardian/);
});

test("historyToContents maps assistant->model, keeps user, drops empties", () => {
  const contents = historyToContents([
    { role: "user", text: "Who are my children?" },
    { role: "assistant", text: "You have two." },
    { role: "assistant", text: "" }, // dropped
    { role: "user" }, // dropped (no text)
  ]);
  assert.deepEqual(contents, [
    { role: "user", parts: [{ text: "Who are my children?" }] },
    { role: "model", parts: [{ text: "You have two." }] },
  ]);
});

test("historyToContents is empty-safe", () => {
  assert.deepEqual(historyToContents(), []);
  assert.deepEqual(historyToContents([]), []);
});
