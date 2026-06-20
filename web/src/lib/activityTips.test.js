import { describe, it, expect } from "vitest";

import {
  NATIVE_LANG,
  TIP_SECTIONS,
  tipsLangFor,
  buildTipsSections,
  tipLineId,
  tipSequence,
} from "./activityTips.js";

describe("activityTips", () => {
  it("declares the three tip sections in display order", () => {
    expect(TIP_SECTIONS.map((s) => s.key)).toEqual(["tips", "watchFor", "encourage"]);
    for (const s of TIP_SECTIONS) {
      expect(s.icon).toBeTruthy();
      expect(s.title).toBeTruthy();
    }
  });

  describe("tipsLangFor", () => {
    it("defaults to the family's native language (Urdu)", () => {
      expect(tipsLangFor(undefined)).toBe(NATIVE_LANG);
      expect(tipsLangFor({})).toBe(NATIVE_LANG);
      expect(tipsLangFor({ lang: "" })).toBe(NATIVE_LANG);
    });
    it("honours an explicit lang on the payload", () => {
      expect(tipsLangFor({ lang: "en" })).toBe("en");
    });
    it("accepts a custom fallback", () => {
      expect(tipsLangFor({}, "ar")).toBe("ar");
    });
  });

  describe("buildTipsSections", () => {
    it("returns only non-empty sections with cleaned items", () => {
      const sections = buildTipsSections({
        tips: ["پہلا مشورہ", "  ", "دوسرا مشورہ"],
        watchFor: [],
        encourage: ["ماشاء اللہ"],
      });
      expect(sections.map((s) => s.key)).toEqual(["tips", "encourage"]);
      expect(sections[0].items).toEqual(["پہلا مشورہ", "دوسرا مشورہ"]);
      expect(sections[1].items).toEqual(["ماشاء اللہ"]);
    });

    it("drops blank-only and non-string entries", () => {
      const sections = buildTipsSections({ tips: ["", "   ", 5, null, "ok"] });
      expect(sections).toHaveLength(1);
      expect(sections[0].items).toEqual(["ok"]);
    });

    it("returns an empty array for missing / empty payloads", () => {
      expect(buildTipsSections(undefined)).toEqual([]);
      expect(buildTipsSections({})).toEqual([]);
      expect(buildTipsSections({ tips: [], watchFor: [], encourage: [] })).toEqual([]);
    });
  });

  describe("tipLineId", () => {
    it("matches the SpeakButton speakId format (lang:voiceName:text, empty voice)", () => {
      expect(tipLineId("ur", "سلام")).toBe("ur::سلام");
    });
  });

  describe("tipSequence", () => {
    it("maps items to speakSequence turns with stable, line-matching ids", () => {
      const seq = tipSequence("ur", ["ایک", "دو"]);
      expect(seq).toEqual([
        { text: "ایک", lang: "ur", id: "ur::ایک", rate: 0.95 },
        { text: "دو", lang: "ur", id: "ur::دو", rate: 0.95 },
      ]);
    });
    it("honours a custom rate and tolerates no items", () => {
      expect(tipSequence("en", ["go"], { rate: 0.8 })[0].rate).toBe(0.8);
      expect(tipSequence("ur")).toEqual([]);
    });
  });
});
