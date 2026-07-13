import { describe, it, expect } from "vitest";
import { describeContentProvider, providerClass } from "./modelLabels.js";

describe("describeContentProvider", () => {
  it("returns null when no provider is recorded (pre-tracking activities)", () => {
    expect(describeContentProvider("", "")).toBeNull();
    expect(describeContentProvider(undefined, undefined)).toBeNull();
  });

  it("maps a known model to its friendly label + tooltip", () => {
    const d = describeContentProvider("anthropic", "claude-sonnet-5");
    expect(d.text).toBe("Claude Sonnet 5");
    expect(d.title).toBe("Claude Sonnet 5 (Anthropic Claude)");
    expect(d.providerClass).toBe("anthropic");
  });

  it("falls back to the raw model id when the model isn't in the catalog", () => {
    const d = describeContentProvider("gemini", "gemini-2.5-flash-experimental");
    expect(d.text).toBe("gemini-2.5-flash-experimental");
    expect(d.title).toBe("gemini-2.5-flash-experimental (Google Gemini)");
  });

  it("falls back to the provider label when neither model nor catalog entry exists", () => {
    const d = describeContentProvider("openai", "");
    expect(d.text).toBe("OpenAI");
  });

  it("providerClass falls back to 'unknown' for an unrecognized provider string", () => {
    expect(providerClass("anthropic")).toBe("anthropic");
    expect(providerClass("some-future-provider")).toBe("unknown");
  });
});
