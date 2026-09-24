import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_KEYS, AGENT_DEFAULTS, mergeAgentConfig, resolveTextProvider, effectiveTextModel, secretNameForProvider } from "../agents/agentConfig.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../agents/llm.js";

test("AGENT_KEYS covers every configurable agent", () => {
  assert.deepEqual(AGENT_KEYS, ["guide", "curriculum", "syllabus", "content", "scheduler", "brief", "image", "tts", "explore"]);
});

test("mergeAgentConfig falls back to built-in defaults when nothing stored", () => {
  const cfg = mergeAgentConfig({ default: {}, agents: {} }, "content");
  assert.equal(cfg.model, AGENT_DEFAULTS.content.model);
  assert.equal(cfg.temperature, 0.5);
  assert.equal(cfg.maxOutputTokens, 8192); // raised from 4096 to avoid truncating large qaida/reading content
});

test("mergeAgentConfig: stored default overrides built-in, agent override wins over default", () => {
  const doc = {
    default: { model: "gemini-default", temperature: 0.9 },
    agents: { guide: { model: "gemini-guide" } },
  };
  const guide = mergeAgentConfig(doc, "guide");
  assert.equal(guide.model, "gemini-guide");      // agent override wins
  assert.equal(guide.temperature, 0.9);            // inherited from default

  const syllabus = mergeAgentConfig(doc, "syllabus");
  assert.equal(syllabus.model, "gemini-default");  // no agent override → default
  assert.equal(syllabus.temperature, 0.9);
});

test("mergeAgentConfig: global default cannot lower a per-agent token ceiling", () => {
  // Platform UI seeds the global default at 2048 and persists it on "Save all
  // agent settings". That must not truncate curriculum/content, whose built-in
  // is 8192 (large finalize_curriculum / content tool-call payloads).
  const doc = { default: { maxOutputTokens: 2048 }, agents: {} };

  const curriculum = mergeAgentConfig(doc, "curriculum");
  assert.ok(curriculum.maxOutputTokens >= 8192, `curriculum kept ${curriculum.maxOutputTokens}`);

  const content = mergeAgentConfig(doc, "content");
  assert.ok(content.maxOutputTokens >= 8192, `content kept ${content.maxOutputTokens}`);

  // Agents whose built-in is at/below the default still take the default.
  const guide = mergeAgentConfig(doc, "guide");
  assert.equal(guide.maxOutputTokens, 2048);
});

test("mergeAgentConfig: explicit per-agent override may still lower the ceiling", () => {
  const doc = { default: { maxOutputTokens: 2048 }, agents: { curriculum: { maxOutputTokens: 4096 } } };
  const curriculum = mergeAgentConfig(doc, "curriculum");
  assert.equal(curriculum.maxOutputTokens, 4096); // explicit superadmin choice wins
});

test("mergeAgentConfig: global default may still raise a token ceiling", () => {
  const doc = { default: { maxOutputTokens: 16384 }, agents: {} };
  const curriculum = mergeAgentConfig(doc, "curriculum");
  assert.equal(curriculum.maxOutputTokens, 16384);
});

test("mergeAgentConfig keeps the tts voiceName", () => {
  const cfg = mergeAgentConfig({ default: {}, agents: { tts: { voiceName: "Puck" } } }, "tts");
  assert.equal(cfg.voiceName, "Puck");
  assert.equal(cfg.model, AGENT_DEFAULTS.tts.model);
});

test("mergeAgentConfig keeps the tts provider override (OpenAI round-trips)", () => {
  // Regression: a saved OpenAI TTS override must survive a reload. Earlier the
  // provider field was dropped on read/write, so the Platform screen reverted to
  // Gemini even though the save "succeeded".
  const doc = {
    default: { model: "gemini-2.5-flash" }, // a "Save all agent settings" seeds this
    agents: { tts: { provider: "openai", model: "gpt-4o-mini-tts", voiceName: "alloy" } },
  };
  const cfg = mergeAgentConfig(doc, "tts");
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "gpt-4o-mini-tts"); // override beats the global text default
  assert.equal(cfg.voiceName, "alloy");
});

test("mergeAgentConfig defaults the tts provider to gemini when unset", () => {
  const cfg = mergeAgentConfig({ default: {}, agents: {} }, "tts");
  assert.equal(cfg.provider, "gemini");
});

test("mergeAgentConfig ignores unknown / malformed fields", () => {
  const cfg = mergeAgentConfig({ default: { temperature: "not-a-number", junk: 1 }, agents: {} }, "guide");
  assert.equal(cfg.temperature, AGENT_DEFAULTS.guide.temperature); // bad value dropped
  assert.equal(cfg.junk, undefined);
});

test("resolveTextProvider: explicit provider wins", () => {
  assert.equal(resolveTextProvider("openai", "gemini-2.5-flash"), "openai"); // explicit beats model id
  assert.equal(resolveTextProvider("gemini", "gpt-4o-mini"), "gemini");
  assert.equal(resolveTextProvider("anthropic", "gemini-2.5-flash"), "anthropic");
});

test("resolveTextProvider: infers from the model id when provider is unset", () => {
  assert.equal(resolveTextProvider(undefined, "gpt-4o-mini"), "openai");
  assert.equal(resolveTextProvider(undefined, "gpt-4.1"), "openai");
  assert.equal(resolveTextProvider(undefined, "o3-mini"), "openai");
  assert.equal(resolveTextProvider(undefined, "claude-sonnet-5"), "anthropic");
  assert.equal(resolveTextProvider(undefined, "claude-opus-4-8"), "anthropic");
  assert.equal(resolveTextProvider(undefined, "gemini-2.5-flash"), "gemini");
  assert.equal(resolveTextProvider(undefined, undefined), "gemini"); // default
  assert.equal(resolveTextProvider("", ""), "gemini");
});

test("effectiveTextModel: coerces a stale cross-provider model onto the provider's default", () => {
  // The exact footgun: provider switched to OpenAI but the model still reads a
  // Gemini id — sending that to OpenAI would 404. Coerce it to the OpenAI default.
  assert.equal(effectiveTextModel("openai", "gemini-2.5-flash-lite"), "gpt-4o-mini");
  assert.equal(effectiveTextModel("gemini", "gpt-4o-mini"), "gemini-2.5-flash");
  assert.equal(effectiveTextModel("anthropic", "gemini-2.5-flash"), DEFAULT_ANTHROPIC_MODEL);
  // A model that already fits the provider passes through unchanged.
  assert.equal(effectiveTextModel("openai", "gpt-4o"), "gpt-4o");
  assert.equal(effectiveTextModel("gemini", "gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(effectiveTextModel("anthropic", "claude-opus-4-8"), "claude-opus-4-8");
  // Empty/missing → the provider default.
  assert.equal(effectiveTextModel("openai", ""), "gpt-4o-mini");
  assert.equal(effectiveTextModel("gemini", undefined), "gemini-2.5-flash");
  assert.equal(effectiveTextModel("anthropic", undefined), DEFAULT_ANTHROPIC_MODEL);
});

test("secretNameForProvider maps each provider to its secret", () => {
  assert.equal(secretNameForProvider("openai"), "OPENAI_API_KEY");
  assert.equal(secretNameForProvider("anthropic"), "ANTHROPIC_API_KEY");
  assert.equal(secretNameForProvider("gemini"), "GEMINI_API_KEY");
  assert.equal(secretNameForProvider(undefined), "GEMINI_API_KEY");
});
