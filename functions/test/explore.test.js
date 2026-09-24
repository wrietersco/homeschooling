import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageFromDob, formatChildBrief, buildExploreSystemPrompt, capResult, sanitizeHighlights, highlightsFromArgs, formatParentStyle, HIGHLIGHT_LIMITS,
  createExploreTools, EXPLORE_TOOL_DECLARATIONS, MODES,
} from "../agents/explore.js";

const NOW = new Date("2026-09-20T00:00:00Z");

test("ageFromDob computes age and rejects junk", () => {
  assert.equal(ageFromDob("2020-09-21", NOW), 5);
  assert.equal(ageFromDob("2020-09-20", NOW), 6);
  assert.equal(ageFromDob("", NOW), null);
  assert.equal(ageFromDob("nope", NOW), null);
  assert.equal(ageFromDob("1990-01-01", NOW), null); // not a child
});

test("formatChildBrief includes the key facts and leaves out ageing observations", () => {
  const out = formatChildBrief(
    {
      child: { name: "Hadi", dob: "2020-01-01", strengths: "curious", goals: "read Qaida" },
      family: { guidingLight: "Quran first" },
      interests: [{ topic: "space rockets" }, { topic: "dinosaurs" }],
      skills: [{ name: "Phonics" }],
      scores: [{ completed: true, activityTitle: "Letter A" }, { completed: false, activityTitle: "Letter B" }],
      observations: [{ text: "loved the story" }],
    },
    NOW
  );
  assert.match(out, /Hadi, age 6/);
  assert.match(out, /space rockets, dinosaurs/);
  assert.match(out, /1\/2 completed/);
  assert.match(out, /Quran first/);
  // Point-in-time notes go stale, so they are fetched with get_observations
  // instead of being asserted as current fact at hello.
  assert.ok(!/loved the story/.test(out));
});

test("the child's own profile goes in WHOLE — it is the most durable thing the buddy knows", () => {
  const long = "He is shy with new people but lights up around trains. ".repeat(6); // ~330 chars
  const out = formatChildBrief({ child: { name: "Hadi", strengths: long, weaknesses: long, goals: long, comments: long } });
  // The old 160/240-char clips cut mid-sentence; the full text now survives.
  assert.ok(out.includes(long.trim()), "strengths should not be truncated");
  assert.equal(out.split("lights up around trains").length - 1, 24); // 6 repeats x 4 fields
  assert.match(out, /Goals the parents have for Hadi/);
  assert.match(out, /What the parents say about Hadi/);
  // A pathological paste is still bounded.
  const huge = formatChildBrief({ child: { name: "H", comments: "x".repeat(5000) } });
  assert.ok(huge.length < 1500);
});

test("formatChildBrief survives an empty child", () => {
  assert.match(formatChildBrief({}), /CHILD: the child/);
});

test("system prompt differs by mode and embeds brief, focus and platform text", () => {
  const brief = "CHILD: Hadi.";
  const ex = buildExploreSystemPrompt({ mode: "explore", brief, platform: "PLATFORM-RULE" });
  const le = buildExploreSystemPrompt({ mode: "learn", brief, focus: "the letter S sound" });
  assert.match(ex, /Pixar-style/);
  assert.match(ex, /PLATFORM-RULE/);
  assert.match(le, /LEARNING/);
  assert.match(le, /letter S sound/);
  assert.match(le, /CHILD: Hadi/);
  assert.match(le, /CURRENT DATE/);
  assert.deepEqual(MODES, ["explore", "learn"]);
});

test("unknown mode falls back to explore", () => {
  assert.match(buildExploreSystemPrompt({ mode: "??", brief: "x" }), /EXPLORATION/);
});

test("capResult truncates oversized results", () => {
  assert.deepEqual(capResult({ a: 1 }), { a: 1 });
  const big = capResult({ s: "x".repeat(10000) });
  assert.equal(big.truncated, true);
  assert.ok(big.preview.length <= 2500);
});

test("every declared tool has an implementation", () => {
  const tools = createExploreTools({ db: fakeDb(), familyId: "f", childId: "c", uid: "u" });
  for (const d of EXPLORE_TOOL_DECLARATIONS) assert.equal(typeof tools[d.name], "function", d.name);
});

// Minimal Firestore fake: records writes, returns canned reads.
function fakeDb({ scores = [], obs = [] } = {}) {
  const writes = [];
  const q = (docs) => {
    const api = {
      where: () => api, orderBy: () => api, limit: () => api,
      get: async () => ({ docs: docs.map((data, i) => ({ id: String(i), data: () => data })) }),
      doc: (id) => ({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (d) => writes.push({ id, d }),
        collection: () => q([]),
      }),
      add: async (d) => { writes.push({ d }); return { id: "new" }; },
    };
    return api;
  };
  const db = {
    writes,
    collection: () => ({ doc: () => ({ collection: (name) => q(name === "scores" ? scores : name === "observations" ? obs : []) }) }),
  };
  return db;
}

test("get_recent_progress maps and caps scores; scoped by childId", async () => {
  const db = fakeDb({ scores: [{ activityTitle: "A", completed: true, dateKey: "2026-09-19" }] });
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u" });
  const r = await tools.get_recent_progress({ limit: 999 });
  assert.deepEqual(r.activities, [{ title: "A", completed: true, date: "2026-09-19" }]);
});

test("record_learning_note writes an explore-sourced observation for the child", async () => {
  const db = fakeDb();
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u1" });
  assert.deepEqual(await tools.record_learning_note({ note: "  said S well  " }), { saved: true });
  const w = db.writes[0].d;
  assert.equal(w.childId, "c");
  assert.equal(w.text, "said S well");
  assert.equal(w.source, "explore");
  assert.deepEqual(await tools.record_learning_note({ note: "" }), { saved: false });
});

test("celebrate is declared for the model and acknowledges without writing anything", async () => {
  const d = EXPLORE_TOOL_DECLARATIONS.find((t) => t.name === "celebrate");
  assert.ok(d, "celebrate must be declared or the model can never call it");
  assert.match(d.description, /confetti/i);
  assert.deepEqual(d.parameters.required ?? [], []); // reason is optional
  const db = fakeDb();
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u" });
  assert.deepEqual(await tools.celebrate({ reason: "  said the k sound  " }), { celebrated: true, reason: "said the k sound" });
  assert.deepEqual(await tools.celebrate(), { celebrated: true, reason: "" });
  assert.equal(db.writes.length, 0); // purely acknowledged; the client does the confetti+sound
});

test("save_interest slugs the topic and rejects empties", async () => {
  const db = fakeDb();
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u" });
  assert.deepEqual(await tools.save_interest({ topic: "Space Rockets!" }), { saved: true });
  assert.equal(db.writes[0].id, "space-rockets");
  assert.equal(db.writes[0].d.count, 1);
  assert.deepEqual(await tools.save_interest({ topic: "!!!" }), { saved: false });
});

import { thinkingConfigFor } from "../agents/explore.js";
import { MODEL_CATALOG, LIVE_VOICES, capabilityForAgent, liveThinkingLevels, liveRequiresThinking, liveVoicesFor, thinkingLiveModels } from "../agents/modelCatalog.js";
import { mergeAgentConfig, AGENT_DEFAULTS } from "../agents/agentConfig.js";

test("thinkingConfigFor sends a level only to models whose catalog entry has thinking", () => {
  assert.deepEqual(thinkingConfigFor({ model: "gemini-3.8-live-extended-thinking" }), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingConfigFor({ model: "gemini-3.8-live-extended-thinking", thinkingLevel: "high" }), { thinkingConfig: { thinkingLevel: "high" } });
  assert.deepEqual(thinkingConfigFor({ model: "gemini-3.8-live" }), {});
  // REGRESSION: a level configured for a model without thinking closed the Live
  // socket with "Thinking level is not supported for this model".
  assert.deepEqual(thinkingConfigFor({ model: "gemini-3.8-live", thinkingLevel: "medium" }), {});
  // A model that DOES accept levels still gets the configured one.
  assert.deepEqual(thinkingConfigFor({ model: "gemini-2.5-flash-native-audio-latest", thinkingLevel: "high" }), { thinkingConfig: { thinkingLevel: "high" } });
  // ...but never one it doesn't offer, and never by default when optional.
  assert.deepEqual(thinkingConfigFor({ model: "gemini-2.5-flash-native-audio-latest" }), {});
  // An invalid level on a model that REQUIRES one still starts (defaults to low).
  assert.deepEqual(thinkingConfigFor({ model: "gemini-3.8-live-extended-thinking", thinkingLevel: "bogus" }), { thinkingConfig: { thinkingLevel: "low" } });
});

test("catalog capability helpers describe each Live model's feature set", () => {
  assert.deepEqual(liveThinkingLevels("gemini-3.8-live-extended-thinking"), ["low", "medium", "high"]);
  assert.deepEqual(liveThinkingLevels("gemini-3.8-live"), []);
  // Verified by connecting for real (scripts/verifyLiveModels.mjs): only the
  // standard 3.8 Live model refuses a thinking level.
  assert.deepEqual(liveThinkingLevels("gemini-2.5-flash-native-audio-latest"), ["low", "medium", "high"]);
  assert.ok(!liveRequiresThinking("gemini-2.5-flash-native-audio-latest"));
  assert.ok(liveRequiresThinking("gemini-3.8-live-extended-thinking"));
  assert.ok(!liveRequiresThinking("gemini-3.8-live"));
  assert.equal(liveVoicesFor("gemini-3.8-live").length, 30);
  assert.ok(thinkingLiveModels().length >= 1);
  // An unknown (hand-pinned) id is judged by its name rather than breaking.
  assert.deepEqual(liveThinkingLevels("gemini-9-live-extended-thinking"), ["low", "medium", "high"]);
  assert.deepEqual(liveThinkingLevels("gemini-9-live"), []);
});

test("explore is a 'live' capability with a verified catalog and the default is in it", () => {
  assert.equal(capabilityForAgent("explore"), "live");
  const ids = MODEL_CATALOG.live.map((m) => m.id);
  assert.ok(ids.includes(AGENT_DEFAULTS.explore.model));
  assert.equal(LIVE_VOICES.length, 30);
  assert.ok(LIVE_VOICES.includes(AGENT_DEFAULTS.explore.voiceName));
  assert.deepEqual(MODEL_CATALOG.live.find((m) => m.id.includes("extended")).thinkingLevels, ["low", "medium", "high"]);
});

test("explore config merges superadmin overrides and clamps session limits", () => {
  const cfg = mergeAgentConfig(
    { default: {}, agents: { explore: { voiceName: "Leda", sessionMinutes: 99, dailySessions: 0, thinkingLevel: "bogus" } } },
    "explore"
  );
  assert.equal(cfg.voiceName, "Leda");
  assert.equal(cfg.sessionMinutes, 30); // clamped
  assert.equal(cfg.dailySessions, 1); // clamped
  assert.equal(cfg.thinkingLevel, ""); // invalid ignored → built-in
  assert.equal(cfg.model, "gemini-3.8-live");
});

test("explore never inherits the global default's TEXT model (regression: 'gemini-2.5-flash is not found for bidiGenerateContent')", () => {
  const doc = { default: { model: "gemini-2.5-flash", temperature: 0.4, systemInstructions: "Be kind." }, agents: {} };
  const cfg = mergeAgentConfig(doc, "explore");
  assert.equal(cfg.model, "gemini-3.8-live");
  assert.equal(cfg.temperature, undefined);
  assert.equal(cfg.systemInstructions, "Be kind."); // shared text still applies
});

test("explore ignores a saved per-agent override that is not a Live model", () => {
  const doc = { default: {}, agents: { explore: { model: "gemini-2.5-flash", voiceName: "Leda" } } };
  const cfg = mergeAgentConfig(doc, "explore");
  assert.equal(cfg.model, "gemini-3.8-live");
  assert.equal(cfg.voiceName, "Leda");
  // a valid Live override is respected
  const ok = mergeAgentConfig({ default: {}, agents: { explore: { model: "gemini-3.1-flash-live-preview" } } }, "explore");
  assert.equal(ok.model, "gemini-3.1-flash-live-preview");
});

import { sanitizeFamilySettings, applyFamilySettings, exploreCapabilities, buildExploreSystemPrompt as bsp } from "../agents/explore.js";

const PLATFORM = mergeAgentConfig({ default: {}, agents: {} }, "explore");

test("sanitizeFamilySettings accepts only verified options and clamps", () => {
  const s = sanitizeFamilySettings({ voiceName: "Leda", learnStyle: "thinking", thinkingLevel: "high", sessionMinutes: 99, notes: "  keep   it short  ", model: "hack" });
  assert.deepEqual(s, { voiceName: "Leda", learnStyle: "thinking", thinkingLevel: "high", sessionMinutes: 30, notes: "keep it short" });
  assert.deepEqual(sanitizeFamilySettings({ voiceName: "NotAVoice", learnStyle: "x", thinkingLevel: "minimal", sessionMinutes: -3 }), {});
  assert.equal(sanitizeFamilySettings({ notes: "x".repeat(900) }).notes.length, 500);
});

test("applyFamilySettings: platform defaults, then family overrides, platform limit is a ceiling", () => {
  const base = applyFamilySettings(PLATFORM, {}, "explore");
  assert.equal(base.model, "gemini-3.8-live");
  assert.equal(base.voiceName, "Puck");
  // Learning defaults to the reliable fast model too (see the unreliable-model test)...
  assert.equal(applyFamilySettings(PLATFORM, {}, "learn").model, "gemini-3.8-live");
  // ...and a parent can pick a voice.
  const fast = applyFamilySettings(PLATFORM, { learnStyle: "fast", voiceName: "Leda" }, "learn");
  assert.equal(fast.model, "gemini-3.8-live");
  assert.equal(fast.voiceName, "Leda");
  // With a reliable thinking model configured, the parent's level applies.
  const thinking = { ...PLATFORM, learnModel: "gemini-3.1-flash-live-preview" };
  assert.equal(applyFamilySettings(thinking, { thinkingLevel: "high" }, "learn").model, "gemini-3.1-flash-live-preview");
  assert.equal(applyFamilySettings(thinking, { thinkingLevel: "high" }, "learn").thinkingLevel, "high");
  // A family can shorten a conversation but never exceed the platform limit.
  assert.equal(applyFamilySettings({ ...PLATFORM, sessionMinutes: 12 }, { sessionMinutes: 30 }, "explore").sessionMinutes, 12);
  assert.equal(applyFamilySettings(PLATFORM, { sessionMinutes: 8 }, "explore").sessionMinutes, 8);
});

test("a family's thinking level never reaches a model without thinking (regression: 'Thinking level is not supported for this model')", () => {
  // The parent saved "medium" for Learning; an EXPLORATION chat runs on the fast
  // model, which has no thinking — the level must be dropped, not carried over.
  const ex = applyFamilySettings(PLATFORM, { thinkingLevel: "medium" }, "explore");
  assert.equal(ex.model, "gemini-3.8-live");
  assert.equal(ex.thinkingLevel, "");
  // Same in Learning mode when the parent chose "Answers quickly".
  const fast = applyFamilySettings(PLATFORM, { learnStyle: "fast", thinkingLevel: "medium" }, "learn");
  assert.equal(fast.model, "gemini-3.8-live");
  assert.equal(fast.thinkingLevel, "");
  // And a stale level saved by the superadmin against a non-thinking model.
  const stale = applyFamilySettings({ ...PLATFORM, thinkingLevel: "high" }, {}, "explore");
  assert.equal(stale.thinkingLevel, "");
});

test("a voice the chosen model can't speak falls back instead of failing the session", () => {
  const eff = applyFamilySettings(PLATFORM, { voiceName: "Leda" }, "explore");
  assert.equal(eff.voiceName, "Leda");
  const bogus = applyFamilySettings({ ...PLATFORM, voiceName: "NotAVoice" }, {}, "explore");
  assert.ok(LIVE_VOICES.includes(bogus.voiceName));
});

test("exploreCapabilities reports only what the configured models support", () => {
  const caps = exploreCapabilities(PLATFORM);
  assert.equal(caps.canThink, false); // the defaults configure no (reliable) thinking model
  assert.deepEqual(caps.thinkingLevels, []);
  assert.equal(caps.voices.length, 30);
  assert.equal(caps.maxMinutes, 20);
  // Levels follow the platform's Learning model when IT is a reliable thinking one.
  const thinks = exploreCapabilities({ ...PLATFORM, learnModel: "gemini-3.1-flash-live-preview" });
  assert.equal(thinks.canThink, true);
  assert.deepEqual(thinks.thinkingLevels, ["low", "medium", "high"]);
});

test("saving drops a preference the configured models can't honour", () => {
  const noThinking = { voices: LIVE_VOICES, canThink: false, thinkingLevels: [], maxMinutes: 20 };
  const s = sanitizeFamilySettings({ learnStyle: "thinking", thinkingLevel: "high", voiceName: "Leda" }, noThinking);
  assert.deepEqual(s, { voiceName: "Leda" });
  const narrow = { voices: ["Puck"], canThink: true, thinkingLevels: ["low"], maxMinutes: 20 };
  assert.deepEqual(sanitizeFamilySettings({ voiceName: "Leda", thinkingLevel: "high" }, narrow), {});
});

test("a stale platform thinking level is cleared when the model can't think", () => {
  const cfg = mergeAgentConfig(
    { default: {}, agents: { explore: { model: "gemini-3.8-live", thinkingLevel: "medium", learnModel: "gemini-3.8-live", learnThinkingLevel: "high" } } },
    "explore"
  );
  assert.equal(cfg.thinkingLevel, "");
  assert.equal(cfg.learnThinkingLevel, "");
  // ...and kept when it can.
  const ok = mergeAgentConfig({ default: {}, agents: { explore: { learnModel: "gemini-3.1-flash-live-preview", learnThinkingLevel: "high" } } }, "explore");
  assert.equal(ok.learnThinkingLevel, "high");
});

test("'thinks harder' never lands on a model flagged unreliable (regression: 'I'm sorry, a system error occurred')", () => {
  // A parent's saved "thinking" style on the default platform stays on the fast model.
  assert.equal(applyFamilySettings(PLATFORM, { learnStyle: "thinking", thinkingLevel: "medium" }, "learn").model, "gemini-3.8-live");
  // Even if the superadmin explicitly picks the flagged model for Learning.
  const cfg = { ...PLATFORM, learnModel: "gemini-3.8-live-extended-thinking", learnThinkingLevel: "medium" };
  const eff = applyFamilySettings(cfg, { learnStyle: "thinking" }, "learn");
  assert.equal(eff.model, "gemini-3.8-live");
  assert.equal(eff.thinkingLevel, "");
  assert.equal(exploreCapabilities(cfg).canThink, false);
  assert.ok(!thinkingLiveModels().some((m) => m.id === "gemini-3.8-live-extended-thinking"));
});

test("parent instructions are included but never override safety", () => {
  const p = bsp({ mode: "learn", brief: "CHILD: Hadi.", parentStyle: { notes: "Practise k and s sounds. Keep replies short." } });
  assert.match(p, /HOW THE PARENTS WANT YOU TO TALK/);
  assert.match(p, /k and s sounds/);
  assert.match(p, /never override the safety rules/);
  assert.doesNotMatch(bsp({ mode: "learn", brief: "x" }), /HOW THE PARENTS WANT YOU TO TALK/);
});

test("family settings round-trip: sanitize is idempotent and drops unknown keys", () => {
  const once = sanitizeFamilySettings({ voiceName: "Kore", notes: "hi", model: "gemini-x", updatedBy: "u" });
  assert.deepEqual(once, { voiceName: "Kore", notes: "hi" });
  assert.deepEqual(sanitizeFamilySettings(once), once);
});

import { isLiveModelId } from "../agents/agentConfig.js";
import { LIVE_PRICING_META } from "../agents/modelCatalog.js";

test("isLiveModelId accepts conversational Live models and rejects specialised ones and text models", () => {
  for (const id of ["gemini-3.8-live", "gemini-3.8-live-extended-thinking", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"]) assert.ok(isLiveModelId(id), id);
  for (const id of ["gemini-2.5-flash", "gemini-3.5-transcribe-live", "gemini-3.5-live-translate-preview", "gemini-robotics-er-2-streaming-preview", ""]) assert.ok(!isLiveModelId(id), id);
});

test("every Live catalog model is conversational, has prices, and per-minute figures match the token rates", () => {
  assert.equal(MODEL_CATALOG.live.length, 6);
  for (const m of MODEL_CATALOG.live) {
    assert.ok(isLiveModelId(m.id), m.id);
    assert.ok(m.price.inAudio > 0 && m.price.outAudio > 0, m.id);
    // Google's conversion: 25 audio tokens/second = 1500 tokens/minute.
    assert.ok(Math.abs(m.price.outAudioPerMin - (m.price.outAudio * 1500) / 1e6) < 0.0005, `${m.id} out/min`);
    assert.ok(Math.abs(m.price.inAudioPerMin - (m.price.inAudio * 1500) / 1e6) < 0.0006, `${m.id} in/min`);
  }
  // Specialised models are listed for reference but never selectable.
  assert.equal(MODEL_CATALOG.liveOther.length, 3);
  for (const m of MODEL_CATALOG.liveOther) assert.ok(!isLiveModelId(m.id), m.id);
  assert.match(LIVE_PRICING_META.source, /pricing/);
});

import { DEFAULT_PRICING } from "../lib/costMeter.js";
import { PRICING_META } from "../agents/modelCatalog.js";

test("every text/speech/image model has a published price", () => {
  for (const kind of ["text", "tts", "image"]) {
    for (const m of MODEL_CATALOG[kind]) {
      assert.ok(m.price, `${kind}/${m.id} has no price`);
      assert.ok(["ok", "deprecating", "unavailable"].includes(m.availability.state), m.id);
    }
  }
  assert.match(PRICING_META.sources.anthropic, /claude/);
});

test("the catalog's published prices match what the cost meter charges (no drift)", () => {
  for (const m of MODEL_CATALOG.text) {
    const r = DEFAULT_PRICING.text[m.id];
    assert.ok(r, `${m.id} missing from costMeter`);
    assert.equal(m.price.in, r.input, `${m.id} input`);
    assert.equal(m.price.out, r.output, `${m.id} output`);
  }
  for (const m of MODEL_CATALOG.tts) {
    if (m.price.perMChars != null) assert.equal(m.price.perMChars, DEFAULT_PRICING.tts[m.id].output, m.id);
    else { assert.equal(m.price.in, DEFAULT_PRICING.tts[m.id].input, m.id); assert.equal(m.price.out, DEFAULT_PRICING.tts[m.id].output, m.id); }
  }
  for (const m of MODEL_CATALOG.image) assert.equal(m.price.perImage, DEFAULT_PRICING.image[m.id].perImage, m.id);
});

test("Claude Sonnet 5 is priced at the permanent $2/$10 (the $3/$15 rise was cancelled)", () => {
  assert.deepEqual([DEFAULT_PRICING.text["claude-sonnet-5"].input, DEFAULT_PRICING.text["claude-sonnet-5"].output], [2, 10]);
});

test("retired / deprecating models are flagged (verified by calling the API)", () => {
  const state = (k, id) => MODEL_CATALOG[k].find((m) => m.id === id).availability.state;
  assert.equal(state("text", "gemini-2.0-flash"), "unavailable");
  assert.equal(state("image", "imagen-4.0-generate-001"), "unavailable");
  assert.equal(state("image", "gemini-2.5-flash-image"), "deprecating");
  assert.equal(MODEL_CATALOG.image.find((m) => m.id === "gemini-2.5-flash-image").availability.date, "2026-10-02");
  assert.equal(state("text", "gemini-2.5-flash"), "ok");
});

// ── Session highlights: free-shaped JSON, hard limits ────────────────────────

test("sanitizeHighlights keeps a free-shaped record and normalises what the model sends", () => {
  // Two sessions, two completely different shapes — both survive intact.
  assert.deepEqual(
    sanitizeHighlights('{"topic":"the k sound","attempts":4,"mastered":true,"stuck_on":"k at word end"}'),
    { topic: "the k sound", attempts: 4, mastered: true, stuck_on: "k at word end" }
  );
  assert.deepEqual(
    sanitizeHighlights({ concept: "sharing 10 sweets", tries_to_understand: 2, what_helped: "real objects" }),
    { concept: "sharing 10 sweets", tries_to_understand: 2, what_helped: "real objects" }
  );
  // Nested detail is allowed, one level deep.
  assert.deepEqual(sanitizeHighlights('{"words":{"cat":"correct","kite":"needed 3 tries"}}'), {
    words: { cat: "correct", kite: "needed 3 tries" },
  });
  // Prose instead of JSON is kept rather than lost.
  assert.deepEqual(sanitizeHighlights("he got it after three tries"), { note: "he got it after three tries" });
  // Nothing usable.
  assert.equal(sanitizeHighlights(""), null);
  assert.equal(sanitizeHighlights("{}"), null);
  assert.equal(sanitizeHighlights(null), null);
  assert.equal(sanitizeHighlights(42), null);
});

test("sanitizeHighlights bounds a model that tries to dump the conversation", () => {
  const transcript = "Buddy: say cat. Child: fat. Buddy: nearly! ".repeat(60);
  const out = sanitizeHighlights(JSON.stringify({ topic: "k sound", transcript }));
  assert.ok(out.transcript.length <= HIGHLIGHT_LIMITS.string);
  assert.equal(out.topic, "k sound");
  // Too many keys, too deep, too long — all clamped.
  const wide = {};
  for (let i = 0; i < 40; i++) wide[`k${i}`] = `v${i}`;
  assert.ok(Object.keys(sanitizeHighlights(wide)).length <= HIGHLIGHT_LIMITS.keys);
  assert.equal(sanitizeHighlights({ a: { b: { c: { d: "too deep" } } } }), null);
  const big = sanitizeHighlights(JSON.stringify({ a: "x".repeat(400), b: "y".repeat(400), c: "z".repeat(400) }));
  assert.ok(JSON.stringify(big).length <= HIGHLIGHT_LIMITS.json);
  // Keys are cleaned, junk values dropped.
  assert.deepEqual(sanitizeHighlights({ "bad/key!": "v", nope: null, nan: NaN }), { badkey: "v" });
});

test("record_session_highlights writes to the verified session only", async () => {
  const writes = [];
  const session = { childId: "c", highlights: [{ topic: "old" }] };
  const doc = () => ({
    get: async () => ({ exists: true, data: () => session }),
    set: async (d) => writes.push(d),
  });
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc }) }) }) };
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u", sessionId: "s1" });

  assert.deepEqual(await tools.record_session_highlights({ highlights: '{"topic":"k sound","attempts":3}' }), { saved: true });
  assert.equal(writes[0].highlights.length, 2); // appended, not replaced
  assert.equal(writes[0].highlights[1].topic, "k sound");
  assert.ok(writes[0].highlights[1].at instanceof Date);

  // No session bound (an older client, or a lost id) → nothing is written.
  const loose = createExploreTools({ db, familyId: "f", childId: "c", uid: "u" });
  assert.deepEqual(await loose.record_session_highlights({ highlights: '{"a":1}' }), { saved: false });
  // A session belonging to a different child is refused.
  session.childId = "other";
  assert.deepEqual(await tools.record_session_highlights({ highlights: '{"a":1}' }), { saved: false });
});

test("a session can't grow without bound however chatty the model is", async () => {
  let stored = Array.from({ length: HIGHLIGHT_LIMITS.perSession }, (_, i) => ({ topic: `t${i}` }));
  const doc = () => ({
    get: async () => ({ exists: true, data: () => ({ childId: "c", highlights: stored }) }),
    set: async (d) => { stored = d.highlights; },
  });
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc }) }) }) };
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u", sessionId: "s1" });
  await tools.record_session_highlights({ highlights: '{"topic":"newest"}' });
  assert.equal(stored.length, HIGHLIGHT_LIMITS.perSession);
  assert.equal(stored[stored.length - 1].topic, "newest"); // newest kept, oldest dropped
  assert.equal(stored[0].topic, "t1");
});

test("the highlights tool names the pedagogical facts and keeps room for the rest", () => {
  const d = EXPLORE_TOOL_DECLARATIONS.find((t) => t.name === "record_session_highlights");
  assert.ok(d, "tool must be declared or the model can never call it");
  assert.match(d.description, /never include the conversation/i);
  // Named fields, because a live run showed a free-JSON parameter answered with
  // prose — which loses the numbers parents actually want.
  const props = d.parameters.properties;
  for (const f of ["topic", "attempts", "tries_to_understand", "outcome", "struggled_with", "what_helped", "extra"]) {
    assert.ok(props[f], `${f} must be offered to the model`);
  }
  assert.equal(props.attempts.type, "number");
  assert.equal(props.tries_to_understand.type, "number");
  assert.deepEqual(d.parameters.required, ["topic"]);
});

// ── Parent delivery instructions ─────────────────────────────────────────────

test("formatParentStyle turns parents' choices into hard directives", () => {
  const out = formatParentStyle({ pace: "slow", replyLength: "tiny", language: "english", avoid: "never mention his stammer", notes: "He loves trains." });
  assert.match(out, /SPEAK SLOWLY/);
  assert.match(out, /ONE short sentence per turn/);
  assert.match(out, /SPEAK ENGLISH ONLY/);
  assert.match(out, /overrides the earlier instruction/); // beats "match the child's language"
  assert.match(out, /BE CAREFUL: never mention his stammer/);
  assert.match(out, /He loves trains\./);
  assert.match(out, /never override the safety rules/);
  // Defaults add nothing to the prompt.
  assert.equal(formatParentStyle({ pace: "normal", replyLength: "normal", language: "auto" }), "");
  assert.equal(formatParentStyle({}), "");
});

test("the parents' instructions land last, so they outrank the generic style guidance", () => {
  const p = buildExploreSystemPrompt({
    mode: "learn",
    brief: "CHILD: Hadi.",
    parentStyle: { replyLength: "tiny", language: "english" },
  });
  assert.ok(p.indexOf("HOW THE PARENTS WANT YOU TO TALK") > p.indexOf("MODE: LEARNING"));
  assert.ok(p.indexOf("HOW THE PARENTS WANT YOU TO TALK") < p.indexOf("CHILD: Hadi."));
  // A bare string (legacy callers / plain notes) still works.
  assert.match(buildExploreSystemPrompt({ mode: "explore", brief: "b", parentStyle: "Keep it gentle." }), /Keep it gentle\./);
});

test("delivery choices are validated and carried into the effective config", () => {
  const s = sanitizeFamilySettings({ pace: "slow", replyLength: "tiny", language: "english", avoid: "  no   scary animals  " });
  assert.deepEqual(s, { pace: "slow", replyLength: "tiny", language: "english", avoid: "no scary animals" });
  assert.deepEqual(sanitizeFamilySettings({ pace: "sprint", replyLength: "epic", language: "klingon", avoid: "" }), {});
  assert.equal(sanitizeFamilySettings({ avoid: "x".repeat(900) }).avoid.length, 300);

  const eff = applyFamilySettings(PLATFORM, { pace: "slow", language: "english", notes: "hi" }, "explore");
  assert.deepEqual(eff.style, { pace: "slow", replyLength: "normal", language: "english", avoid: "", notes: "hi" });
});

test("the parent's celebration choice is validated, stored and handed to the session", () => {
  assert.deepEqual(sanitizeFamilySettings({ celebration: "clapping" }), { celebration: "clapping" });
  assert.deepEqual(sanitizeFamilySettings({ celebration: "airhorn" }), {});
  assert.equal(applyFamilySettings(PLATFORM, { celebration: "barakallah" }, "learn").celebration, "barakallah");
  // Nothing chosen yet → Masha'Allah with clapping.
  assert.equal(applyFamilySettings(PLATFORM, {}, "explore").celebration, "mashallah_clap");
});

test("highlightsFromArgs folds the named fields and free `extra` into one record", () => {
  // What the model really sends (verified against the live API).
  assert.deepEqual(
    highlightsFromArgs({ topic: "the k sound", attempts: 3, outcome: "mastered", what_helped: "tongue back" }),
    { topic: "the k sound", attempts: 3, outcome: "mastered", what_helped: "tongue back" }
  );
  // Per-session extras ride along, without overwriting a named field.
  assert.deepEqual(
    highlightsFromArgs({ topic: "counting", extra: '{"mood":"excited","topic":"ignored"}' }),
    { mood: "excited", topic: "counting" }
  );
  // Junk in `extra` never loses the named record.
  assert.deepEqual(highlightsFromArgs({ topic: "t", extra: "not json" }), { note: "not json", topic: "t" });
  // The old single-JSON-string shape still stores (an in-flight session mid-deploy).
  assert.deepEqual(highlightsFromArgs({ highlights: '{"topic":"legacy","attempts":2}' }), { topic: "legacy", attempts: 2 });
  assert.equal(highlightsFromArgs({}), null);
});

test("filing the same topic twice updates it instead of repeating it to parents", async () => {
  let stored = [];
  const doc = () => ({
    get: async () => ({ exists: true, data: () => ({ childId: "c", highlights: stored }) }),
    set: async (d) => { stored = d.highlights; },
  });
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc }) }) }) };
  const tools = createExploreTools({ db, familyId: "f", childId: "c", uid: "u", sessionId: "s1" });
  await tools.record_session_highlights({ topic: "the k sound", attempts: 2, outcome: "improving" });
  await tools.record_session_highlights({ topic: "counting to 10", outcome: "mastered" });
  await tools.record_session_highlights({ topic: "The K Sound", attempts: 3, outcome: "mastered" });
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map((h) => h.topic), ["counting to 10", "The K Sound"]);
  assert.equal(stored[1].outcome, "mastered"); // the later, fuller record won
});
