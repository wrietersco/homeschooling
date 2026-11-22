import { describe, it, expect } from "vitest";
import { SECTION_SLUGS, DEFAULT_SECTION, sectionFromSlug, sectionLocation } from "./platformNav.js";

describe("platformNav", () => {
  it("bare /platform is the default section", () => {
    expect(sectionFromSlug("")).toBe(DEFAULT_SECTION);
    expect(sectionFromSlug(undefined)).toBe("families");
  });
  it("every section round-trips through its slug", () => {
    for (const id of Object.keys(SECTION_SLUGS)) {
      const { path } = sectionLocation(id);
      expect(sectionFromSlug(path.split("/")[2])).toBe(id);
    }
  });
  it("uses readable slugs for the renamed sections", () => {
    expect(sectionLocation("llm").path).toBe("/platform/ai-config");
    expect(sectionLocation("quota").path).toBe("/platform/capacity");
    expect(sectionLocation("subscriptions").path).toBe("/platform/plans");
    expect(sectionLocation("costs", { family: "f1" })).toEqual({ path: "/platform/costs", query: { family: "f1" } });
  });
  it("rejects unknown slugs", () => {
    expect(sectionFromSlug("nope")).toBeNull();
  });
});
