import { describe, it, expect } from "vitest";
import { firstSentence } from "./sentence";

describe("firstSentence", () => {
  it("returns the whole text when there is no sentence terminator", () => {
    expect(firstSentence("hello there")).toBe("hello there");
  });

  it("returns the whole text unchanged when it's already one sentence", () => {
    expect(firstSentence("Hello there!")).toBe("Hello there!");
  });

  it("cuts at the first terminator, dropping the rest of the paragraph", () => {
    expect(firstSentence("First sentence. Second sentence. Third.")).toBe("First sentence.");
  });

  it("handles Arabic question marks", () => {
    expect(firstSentence("هل أنت بخير؟ هذا سؤال ثانٍ.")).toBe("هل أنت بخير؟");
  });

  it("handles Urdu full stops", () => {
    expect(firstSentence("یہ پہلا جملہ ہے۔ یہ دوسرا جملہ ہے۔")).toBe("یہ پہلا جملہ ہے۔");
  });

  it("returns an empty string for empty input", () => {
    expect(firstSentence("")).toBe("");
    expect(firstSentence(null)).toBe("");
  });

  it("caps a runaway sentence with no punctuation at a word boundary", () => {
    const long = "word ".repeat(80).trim(); // 400 chars, no terminator
    const out = firstSentence(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // trimmed before the ellipsis
  });
});
