// Integration test for the agent tool layer, ReAct runtime, and grounding,
// against the Firestore emulator. Run via:
//   firebase emulators:exec --only firestore,functions "node --test tests/agents/*.e2e.mjs"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { createTools } from "../../functions/agents/tools.js";
import { runAgent } from "../../functions/agents/runtime.js";
import { filterDeclarations, READ_ONLY_TOOL_NAMES } from "../../functions/agents/tools.js";
import { buildGroundedSystemPrompt } from "../../functions/agents/grounding.js";

let db;
const FAM_A = "agentFamA";
const FAM_B = "agentFamB";

before(async () => {
  // Must match the emulator's project so Firestore triggers (e.g. the agent
  // index) fire for our writes — the functions emulator only watches the
  // project it runs as (from .firebaserc).
  admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();
  // Seed two families so we can prove tenant isolation.
  const a = db.collection("families").doc(FAM_A);
  await a.set({ name: "Alpha" });
  await a.collection("profile").doc("family").set({
    familyName: "Alpha", guidingLight: "The Quran above all.", goalMode: "individual",
  });
  await a.collection("children").doc("c1").set({ name: "Hadi", dob: "2018-01-01" });
  await a.collection("children").doc("c2").set({ name: "Ibrahim", dob: "2019-02-02" });
  await a.collection("children").doc("c3").set({ name: "Yusuf", dob: "2020-03-03" });

  const b = db.collection("families").doc(FAM_B);
  await b.set({ name: "Beta" });
  await b.collection("children").doc("x1").set({ name: "Outsider" });
});

function toolsFor(role, mode) {
  const run = { audit: [] };
  const { impls } = createTools({ db, familyId: FAM_A, uid: "ownerA", role, mode, run });
  return { impls, run };
}

test("query_collection returns only the caller's family data", async () => {
  const { impls } = toolsFor("owner", "read");
  const res = await impls.query_collection({ collection: "children", orderByField: "name" });
  const names = res.rows.map((r) => r.name);
  assert.ok(names.includes("Hadi") && names.includes("Ibrahim"));
  assert.ok(!names.includes("Outsider")); // family B is unreachable
});

test("get_document fetches by id; missing returns exists:false", async () => {
  const { impls } = toolsFor("owner", "read");
  assert.equal((await impls.get_document({ collection: "children", id: "c1" })).name, "Hadi");
  assert.equal((await impls.get_document({ collection: "children", id: "nope" })).exists, false);
});

test("query_collection reports hasMore + handle, and read_context reads a slice", async () => {
  const { impls } = toolsFor("owner", "read");
  const res = await impls.query_collection({ collection: "children", limit: 1 });
  assert.equal(res.rows.length, 1);
  assert.equal(res.hasMore, true);
  assert.ok(res.handle);
  const slice = await impls.read_context({ handle: res.handle, start: 0, count: 5 });
  assert.ok(slice.rows.length >= 1);
});

test("reads of non-whitelisted collections are rejected", async () => {
  const { impls } = toolsFor("owner", "read");
  await assert.rejects(() => impls.query_collection({ collection: "agentRuns" }), /not readable/);
});

test("write tools create/update/delete and append to the audit trail", async () => {
  const { impls, run } = toolsFor("owner", "write");
  const created = await impls.create_document({ collection: "observations", data: { text: "great focus" } });
  assert.ok(created.id);
  await impls.update_document({ collection: "observations", id: created.id, data: { text: "edited" } });
  await impls.delete_document({ collection: "observations", id: created.id });
  const actions = run.audit.map((a) => a.action);
  assert.deepEqual(actions, ["create", "update", "delete"]);
  assert.equal(run.audit[0].collection, "observations");
});

test("read-mode agents cannot write", async () => {
  const { impls } = toolsFor("owner", "read");
  await assert.rejects(() => impls.create_document({ collection: "observations", data: {} }), /write not permitted/);
});

test("viewer role cannot write even in write mode", async () => {
  const { impls } = toolsFor("viewer", "write");
  await assert.rejects(() => impls.create_document({ collection: "observations", data: {} }), /write not permitted/);
});

test("writes to non-writable collections are rejected", async () => {
  const { impls } = toolsFor("owner", "write");
  await assert.rejects(() => impls.create_document({ collection: "members", data: {} }), /not writable/);
});

test("grounded system prompt injects guiding light + children, scoped to this family", async () => {
  const prompt = await buildGroundedSystemPrompt(db, FAM_A, "BASE PROMPT");
  assert.match(prompt, /BASE PROMPT/);
  assert.match(prompt, /The Quran above all/);
  assert.match(prompt, /Hadi/);
  assert.match(prompt, /only this family/i);
  assert.ok(!prompt.includes("Outsider"));
});

test("runAgent drives the real read tools with a fake LLM", async () => {
  const { impls } = toolsFor("owner", "read");
  // Fake LLM: discover collections, query children, then answer.
  const script = [
    { text: "", functionCalls: [{ name: "list_collections", args: {} }] },
    { text: "", functionCalls: [{ name: "query_collection", args: { collection: "children", orderByField: "name" } }] },
    { text: "Hadi, Ibrahim and Yusuf.", functionCalls: [] },
  ];
  let i = 0;
  const llm = { generate: async () => script[Math.min(i++, script.length - 1)] };

  const result = await runAgent({
    llm, system: "guide", tools: impls,
    toolDeclarations: filterDeclarations(READ_ONLY_TOOL_NAMES),
    userMessage: "Who are my children?",
  });

  assert.equal(result.text, "Hadi, Ibrahim and Yusuf.");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].tool, "query_collection");
  assert.ok(result.steps[1].result.rows.some((r) => r.name === "Hadi"));
});
