import { test } from "node:test";
import assert from "node:assert/strict";
import { familyPaths } from "../lib/paths.js";

// Lightweight fake of the Admin Firestore surface used by familyPaths, so we
// can assert the tenant path layout without booting an emulator.
function fakeDb() {
  const make = (segments) => ({
    segments,
    collection: (name) => make([...segments, name]),
    doc: (id) => make([...segments, id]),
    get path() {
      return segments.join("/");
    },
  });
  return { collection: (name) => make([name]) };
}

test("familyPaths requires a familyId", () => {
  assert.throws(() => familyPaths(fakeDb(), ""), /familyId required/);
});

test("familyPaths builds tenant-scoped paths", () => {
  const p = familyPaths(fakeDb(), "fam1");
  assert.equal(p.family().path, "families/fam1");
  assert.equal(p.member("u1").path, "families/fam1/members/u1");
  assert.equal(p.profile().path, "families/fam1/profile/family");
  assert.equal(p.child("c1").path, "families/fam1/children/c1");
  assert.equal(p.agentIndex().path, "families/fam1/_agent_index");
});
