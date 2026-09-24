import { describe, it, expect } from "vitest";

import {
  GEMINI_TEACHER_VOICE,
  geminiVoiceFromPref,
  geminiVoicePref,
  isGeminiVoicePref,
  resolveWordVoice,
} from "./wordVoicePrefs";

const VOICES = [
  { voiceURI: "Microsoft David - English (United States)", lang: "en-US" },
  { voiceURI: "Microsoft Zira - English (United States)", lang: "en-US" },
];

describe("gemini voice pref codec", () => {
  it("round-trips a voice name", () => {
    const pref = geminiVoicePref("Puck");
    expect(isGeminiVoicePref(pref)).toBe(true);
    expect(geminiVoiceFromPref(pref)).toBe("Puck");
  });

  it("recognizes only complete gemini prefs", () => {
    expect(isGeminiVoicePref("auto")).toBe(false);
    expect(isGeminiVoicePref("gemini|")).toBe(false);
    expect(isGeminiVoicePref("")).toBe(false);
    expect(isGeminiVoicePref(null)).toBe(false);
    expect(isGeminiVoicePref("Microsoft David - English (United States)")).toBe(false);
  });
});

describe("resolveWordVoice", () => {
  it("auto stays auto", () => {
    expect(resolveWordVoice("auto", VOICES)).toEqual({ kind: "auto" });
    expect(resolveWordVoice("", VOICES)).toEqual({ kind: "auto" });
    expect(resolveWordVoice(null, VOICES)).toEqual({ kind: "auto" });
  });

  it("a gemini pick resolves to its voice name, even before the catalog loads", () => {
    expect(resolveWordVoice(geminiVoicePref("Kore"), [])).toEqual({ kind: "gemini", voiceName: "Kore" });
  });

  it("a device voiceURI resolves to the voice object", () => {
    expect(resolveWordVoice(VOICES[1].voiceURI, VOICES)).toEqual({ kind: "device", voice: VOICES[1] });
  });

  it("a stale device pick (uninstalled voice) falls back to auto", () => {
    expect(resolveWordVoice("Some Removed Voice", VOICES)).toEqual({ kind: "auto" });
  });

  it("the teacher voice constant is Leda (matches the bundled phoneme clips)", () => {
    expect(GEMINI_TEACHER_VOICE).toBe("Leda");
  });
});
