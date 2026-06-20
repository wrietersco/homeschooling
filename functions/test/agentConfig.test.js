import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_KEYS, AGENT_DEFAULTS, mergeAgentConfig } from "../agents/agentConfig.js";

test("AGENT_KEYS covers every configurable agent", () => {
  assert.deepEqual(AGENT_KEYS, ["guide", "curriculum", "syllabus", "content", "scheduler", "brief", "image", "tts"]);
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

test("mergeAgentConfig keeps the tts voiceName", () => {
  const cfg = mergeAgentConfig({ default: {}, agents: { tts: { voiceName: "Puck" } } }, "tts");
  assert.equal(cfg.voiceName, "Puck");
  assert.equal(cfg.model, AGENT_DEFAULTS.tts.model);
});

test("mergeAgentConfig ignores unknown / malformed fields", () => {
  const cfg = mergeAgentConfig({ default: { temperature: "not-a-number", junk: 1 }, agents: {} }, "guide");
  assert.equal(cfg.temperature, AGENT_DEFAULTS.guide.temperature); // bad value dropped
  assert.equal(cfg.junk, undefined);
});
