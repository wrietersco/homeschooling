import { test } from "node:test";
import assert from "node:assert/strict";
import { forModel } from "../agents/tools.js";

test("forModel hides inline photos from agents but keeps other fields", () => {
  const row = { id: "c1", name: "Hadi", photo: "data:image/jpeg;base64,AAAA", goals: "read" };
  assert.deepEqual(forModel(row), { id: "c1", name: "Hadi", photo: "[photo]", goals: "read" });
});

test("forModel leaves non-image strings and non-strings alone", () => {
  const row = { url: "https://x/y.png", n: 3, tags: ["data:image/x"] };
  assert.deepEqual(forModel(row), row);
});
