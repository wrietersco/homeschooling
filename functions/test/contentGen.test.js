import { test } from "node:test";
import assert from "node:assert/strict";
import { generateContentForActivity, describeNoContent } from "../agents/activityContent.js";

// A scripted fake LLM: returns the given responses in order, recording the
// generationConfig each call received so we can assert on the retry budget.
function scriptedLlm(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async generate(req) { calls.push(req); return responses[Math.min(i++, responses.length - 1)]; },
  };
}

const MATH = { id: "a1", title: "Addition within 10", type: "mathematics" };
const saveCall = (args) => ({ functionCalls: [{ name: "save_content", args }] });
const PROBLEMS = { kind: "problems", problems: [{ question: "2+3", answer: "5" }] };

const opts = { db: null, geminiApiKey: "", storagePrefix: "" }; // no DB / image side-effects

test("returns content on a clean save_content call (no retry)", async () => {
  const llm = scriptedLlm([saveCall(PROBLEMS), { text: "done" }]);
  const { content, reason } = await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.ok(content, "content should be produced");
  assert.equal(content.problems[0].answer, "5");
  assert.equal(reason, "");
  // stopAfterTool ends the loop the instant save_content fires — no redundant
  // follow-up generate call (the old behavior asked the model again needlessly).
  assert.equal(llm.calls.length, 1);
});

test("retries once on MAX_TOKENS, succeeds, and raises the output budget on retry", async () => {
  const llm = scriptedLlm([
    { text: "partial", finishReason: "MAX_TOKENS" },      // attempt 1: truncated → no tool call
    saveCall(PROBLEMS), { text: "done" },                  // attempt 2: succeeds
  ]);
  const { content, reason } = await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.ok(content, "retry should recover content");
  assert.equal(reason, "");
  // The retry must use a larger budget than the first attempt (truncation fix).
  assert.equal(llm.calls[0].config.maxOutputTokens, 4096);
  assert.equal(llm.calls[1].config.maxOutputTokens, 8192);
});

test("reports a truncation reason when both attempts run out of space", async () => {
  const llm = scriptedLlm([{ text: "", finishReason: "MAX_TOKENS" }, { text: "", finishReason: "MAX_TOKENS" }]);
  const { content, reason } = await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.equal(content, null);
  assert.match(reason, /ran out of output space/i);
});

test("reports a 'no save_content' reason when the model just chats", async () => {
  const llm = scriptedLlm([{ text: "Here is some prose." }, { text: "Still prose." }]);
  const { content, reason } = await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.equal(content, null);
  assert.match(reason, /without calling save_content/i);
});

test("a hollow forced save_content call is retried, then reported as an empty payload", async () => {
  // Forced function calling guarantees the *call* fires; the failure mode now is
  // an empty payload. Both attempts return a shell → null content + clear reason.
  const EMPTY = { kind: "problems", problems: [] };
  const llm = scriptedLlm([saveCall(EMPTY), saveCall(EMPTY)]);
  const { content, reason } = await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.equal(content, null);
  assert.match(reason, /payload was empty/i);
  assert.equal(llm.calls.length, 2); // first attempt + one retry
});

test("a teaching activity embeds a ready-to-use story in its tips content", async () => {
  // The core fix: parent-led (teaching → tips) activities that revolve around a
  // story must carry the FULL story, not tell the parent to go find one.
  const STORY_ACTIVITY = { id: "t1", title: "Empathy Story: Walking in Their Shoes", type: "teaching" };
  const TIPS = {
    kind: "tips",
    tips: {
      lang: "ur",
      story: { title: "ابو بکرؓ کی مہربانی", paragraphs: ["پہلا حصہ۔", "دوسرا حصہ۔", "آخری حصہ۔"], moral: "ہمدردی۔" },
      discussionQuestions: ["بچے نے کیسا محسوس کیا؟", "ہم کیا سیکھتے ہیں؟"],
      tips: ["کہانی آہستہ پڑھیں۔"],
    },
  };
  const llm = scriptedLlm([saveCall(TIPS), { text: "done" }]);
  const { content, reason } = await generateContentForActivity({ activity: STORY_ACTIVITY, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.equal(reason, "");
  assert.ok(content, "tips content should be produced");
  assert.equal(content.kind, "tips");
  assert.equal(content.tips.story.paragraphs.length, 3, "the full story is embedded");
  assert.equal(content.tips.story.moral, "ہمدردی۔");
  assert.equal(content.tips.discussionQuestions.length, 2);
  assert.equal(content.tips.lang, "ur");
});

test("a story-only tips payload (no facilitation tips) is still valid content", async () => {
  // isContentEmpty must treat an embedded story as content even when the bare
  // `tips` list is empty — the story is the deliverable.
  const STORY_ONLY = {
    kind: "tips",
    tips: { story: { paragraphs: ["A complete little story."], moral: "Kindness." } },
  };
  const llm = scriptedLlm([saveCall(STORY_ONLY), { text: "done" }]);
  const { content, reason } = await generateContentForActivity({ activity: { id: "t2", title: "Kindness tale", type: "teaching" }, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.equal(reason, "");
  assert.ok(content, "a story-only tips payload is not empty");
  assert.equal(content.tips.story.paragraphs.length, 1);
});

test("parent guidance is injected into the generation prompt", async () => {
  const llm = scriptedLlm([saveCall(PROBLEMS), { text: "done" }]);
  await generateContentForActivity({
    activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts,
    guidance: "The previous version was far too hard — use numbers under 5 only.",
  });
  // The system prompt the LLM received must carry the parent's instructions so
  // the model knows why it's regenerating and what to change.
  assert.match(llm.calls[0].system, /PARENT'S INSTRUCTIONS FOR THIS REGENERATION/);
  assert.match(llm.calls[0].system, /numbers under 5 only/);
});

test("omitted guidance leaves no guidance block in the prompt", async () => {
  const llm = scriptedLlm([saveCall(PROBLEMS), { text: "done" }]);
  await generateContentForActivity({ activity: MATH, llm, genConfig: { maxOutputTokens: 4096 }, ...opts });
  assert.doesNotMatch(llm.calls[0].system, /PARENT'S INSTRUCTIONS FOR THIS REGENERATION/);
});

test("describeNoContent maps every stop reason to a clear message", () => {
  assert.match(describeNoContent({ stoppedAt: "truncated" }, "problems"), /output space.*\(problems\)/i);
  assert.match(describeNoContent({ stoppedAt: "blocked", blockReason: "SAFETY" }), /filtered \(SAFETY\)/);
  assert.match(describeNoContent({ stoppedAt: "limit" }), /step budget/i);
  assert.match(describeNoContent({ stoppedAt: "final" }), /without calling save_content/i);
});
