import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { setDoc, getDoc, doc, deleteDoc } from "firebase/firestore";

// Run via:  firebase emulators:exec --only firestore "node --test tests/rules/*.test.js"
// (the exec wrapper sets FIRESTORE_EMULATOR_HOST).

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

let testEnv;
const FAM_A = "famA";
const FAM_B = "famB";

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules },
  });
});
after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed membership + a couple of docs with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "families", FAM_A), { name: "A", status: "active" });
    await setDoc(doc(db, "families", FAM_A, "members", "ownerA"), { role: "owner" });
    await setDoc(doc(db, "families", FAM_A, "members", "parentA"), { role: "parent" });
    await setDoc(doc(db, "families", FAM_A, "members", "viewerA"), { role: "viewer" });
    await setDoc(doc(db, "families", FAM_A, "profile", "family"), { familyName: "A" });
    await setDoc(doc(db, "families", FAM_A, "children", "c1"), { name: "Hadi" });
    await setDoc(doc(db, "families", FAM_A, "observations", "o1"), {
      authorUid: "parentA",
      text: "first",
    });
    await setDoc(doc(db, "families", FAM_B), { name: "B", status: "active" });
    await setDoc(doc(db, "families", FAM_B, "members", "ownerB"), { role: "owner" });
    await setDoc(doc(db, "families", FAM_B, "children", "cb"), { name: "Other" });
  });
});

function db(uid, claims) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

test("cross-tenant read is denied", async () => {
  const asB = db("ownerB");
  await assertFails(getDoc(doc(asB, "families", FAM_A, "children", "c1")));
});

test("cross-tenant write is denied", async () => {
  const asB = db("ownerB");
  await assertFails(setDoc(doc(asB, "families", FAM_A, "children", "c1"), { name: "hax" }));
});

test("unauthenticated access is denied", async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "families", FAM_A, "children", "c1")));
});

test("member can read own family content", async () => {
  const asViewer = db("viewerA");
  await assertSucceeds(getDoc(doc(asViewer, "families", FAM_A, "children", "c1")));
});

test("viewer cannot write content", async () => {
  const asViewer = db("viewerA");
  await assertFails(setDoc(doc(asViewer, "families", FAM_A, "children", "c2"), { name: "x" }));
});

test("parent can write content", async () => {
  const asParent = db("parentA");
  await assertSucceeds(setDoc(doc(asParent, "families", FAM_A, "children", "c2"), { name: "x" }));
});

test("only owner can write member docs (parent denied)", async () => {
  const asParent = db("parentA");
  await assertFails(setDoc(doc(asParent, "families", FAM_A, "members", "parentA"), { role: "owner" }));
  const asOwner = db("ownerA");
  await assertSucceeds(setDoc(doc(asOwner, "families", FAM_A, "members", "newGuy"), { role: "viewer" }));
});

test("clients cannot create or delete the family doc", async () => {
  const asOwner = db("ownerA");
  await assertFails(setDoc(doc(asOwner, "families", "famNew"), { name: "nope" }));
  await assertFails(deleteDoc(doc(asOwner, "families", FAM_A)));
});

test("observation author binding: parent cannot edit another's observation", async () => {
  const asOwner = db("ownerA"); // owner is also a writer but not the author
  await assertFails(setDoc(doc(asOwner, "families", FAM_A, "observations", "o1"), {
    authorUid: "parentA",
    text: "tampered",
  }));
  const asParent = db("parentA"); // the author
  await assertSucceeds(setDoc(doc(asParent, "families", FAM_A, "observations", "o1"), {
    authorUid: "parentA",
    text: "edited by author",
  }));
});

test("observation create must stamp the caller as author", async () => {
  const asParent = db("parentA");
  await assertFails(setDoc(doc(asParent, "families", FAM_A, "observations", "o2"), {
    authorUid: "someoneElse",
    text: "spoofed",
  }));
  await assertSucceeds(setDoc(doc(asParent, "families", FAM_A, "observations", "o3"), {
    authorUid: "parentA",
    text: "ok",
  }));
});

test("agent index is read-only for clients", async () => {
  const asOwner = db("ownerA");
  await assertFails(setDoc(doc(asOwner, "families", FAM_A, "_agent_index", "children"), { count: 1 }));
});

test("platform config is superadmin-only; skill registry readable by any signed-in user", async () => {
  const asUser = db("randomUser");
  await assertFails(getDoc(doc(asUser, "platform", "llm_config")));
  await assertSucceeds(getDoc(doc(asUser, "skillRegistry", "s1")));
  const asSuper = db("rootAdmin", { platformRole: "superadmin" });
  await assertSucceeds(setDoc(doc(asSuper, "platform", "llm_config"), { x: 1 }));
});

test("global skill registry: signed-in users cannot write directly (server-only)", async () => {
  const asOwner = db("ownerA");
  await assertFails(setDoc(doc(asOwner, "skillRegistry", "newSkill"), { name: "x" }));
  const asSuper = db("rootAdmin", { platformRole: "superadmin" });
  await assertSucceeds(setDoc(doc(asSuper, "skillRegistry", "newSkill"), { name: "x" }));
});

test("child skill binding: parent may write, viewer may not", async () => {
  const asParent = db("parentA");
  await assertSucceeds(
    setDoc(doc(asParent, "families", FAM_A, "children", "c1", "skills", "s1"), { name: "Reading" })
  );
  const asViewer = db("viewerA");
  await assertFails(
    setDoc(doc(asViewer, "families", FAM_A, "children", "c1", "skills", "s2"), { name: "Reading" })
  );
});

test("superadmin can read any family", async () => {
  const asSuper = db("rootAdmin", { platformRole: "superadmin" });
  await assertSucceeds(getDoc(doc(asSuper, "families", FAM_A, "children", "c1")));
});

test("user doc is private to its owner", async () => {
  const mine = db("me");
  await assertSucceeds(setDoc(doc(mine, "users", "me"), { familyId: "x" }));
  await assertFails(getDoc(doc(mine, "users", "someoneElse")));
});
