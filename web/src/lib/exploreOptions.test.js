import { describe, it, expect } from "vitest";
import { LIVE_VOICES, DEFAULT_SETTINGS, DEFAULT_CAPABILITIES, normalizeSettings, normalizeCapabilities, NOTES_MAX, AVOID_MAX, PACES, REPLY_LENGTHS, LANGUAGES } from "./exploreOptions";

describe("exploreOptions", () => {
  it("offers 30 unique voices including the default", () => {
    expect(LIVE_VOICES).toHaveLength(30);
    expect(new Set(LIVE_VOICES).size).toBe(30);
    expect(LIVE_VOICES).toContain(DEFAULT_SETTINGS.voiceName);
  });

  it("falls back to defaults for empty/invalid input", () => {
    expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ voiceName: "Nope", learnStyle: "x", thinkingLevel: "minimal", sessionMinutes: "abc" })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and clamps ranges", () => {
    const s = normalizeSettings({ voiceName: "Leda", learnStyle: "fast", thinkingLevel: "high", sessionMinutes: 99, notes: "x".repeat(900) });
    expect(s).toMatchObject({ voiceName: "Leda", learnStyle: "fast", thinkingLevel: "high", sessionMinutes: 30 });
    expect(s.notes).toHaveLength(NOTES_MAX);
    expect(normalizeSettings({ sessionMinutes: 1 }).sessionMinutes).toBe(5);
  });
});

describe("exploreOptions capabilities", () => {
  const noThinking = { voices: LIVE_VOICES, canThink: false, thinkingLevels: [], maxMinutes: 20 };

  it("assumes the full feature set until the server says otherwise", () => {
    expect(normalizeCapabilities()).toEqual(DEFAULT_CAPABILITIES);
    expect(normalizeCapabilities({ thinkingLevels: [] }).canThink).toBe(false);
    expect(normalizeCapabilities({ voices: ["Puck"], maxMinutes: 99 })).toMatchObject({ voices: ["Puck"], maxMinutes: 30 });
  });

  it("drops settings the configured models can't honour", () => {
    // No thinking model → the "thinks harder" style can't be chosen at all.
    const s = normalizeSettings({ learnStyle: "thinking", thinkingLevel: "high" }, noThinking);
    expect(s.learnStyle).toBe("fast");
    expect(s.thinkingLevel).toBe("");
    // A narrowed voice list snaps to something the model actually speaks.
    const narrow = normalizeSettings({ voiceName: "Leda" }, { ...noThinking, voices: ["Puck", "Kore"] });
    expect(narrow.voiceName).toBe("Puck");
  });

  it("keeps supported values untouched", () => {
    const s = normalizeSettings({ voiceName: "Callirrhoe", learnStyle: "thinking", thinkingLevel: "low" }, DEFAULT_CAPABILITIES);
    expect(s).toMatchObject({ voiceName: "Callirrhoe", learnStyle: "thinking", thinkingLevel: "low" });
  });
});

describe("how the buddy celebrates", () => {
  it("defaults to Masha'Allah + clapping and keeps a valid choice", () => {
    expect(normalizeSettings().celebration).toBe("mashallah_clap");
    expect(normalizeSettings({ celebration: "clapping" }).celebration).toBe("clapping");
    expect(normalizeSettings({ celebration: "airhorn" }).celebration).toBe("mashallah_clap");
  });
});

describe("how the buddy talks", () => {
  it("defaults to no special instructions", () => {
    expect(normalizeSettings()).toMatchObject({ pace: "normal", replyLength: "normal", language: "auto", avoid: "" });
  });

  it("keeps valid delivery choices and rejects invented ones", () => {
    const s = normalizeSettings({ pace: "slow", replyLength: "tiny", language: "english", avoid: "no scary animals" });
    expect(s).toMatchObject({ pace: "slow", replyLength: "tiny", language: "english", avoid: "no scary animals" });
    expect(normalizeSettings({ pace: "sprint", replyLength: "epic", language: "klingon" })).toMatchObject({
      pace: "normal", replyLength: "normal", language: "auto",
    });
    expect(normalizeSettings({ avoid: "x".repeat(900) }).avoid).toHaveLength(AVOID_MAX);
  });

  it("offers every option the server accepts", () => {
    expect(PACES.map((o) => o.value)).toEqual(["normal", "slow"]);
    expect(REPLY_LENGTHS.map((o) => o.value)).toEqual(["normal", "short", "tiny"]);
    expect(LANGUAGES.map((o) => o.value)).toEqual(["auto", "english", "urdu", "arabic"]);
  });
});
