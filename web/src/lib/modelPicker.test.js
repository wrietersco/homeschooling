import { describe, it, expect } from "vitest";
import { arrangeModels, cheapestIds, disabledReason, priceChip, isRetired, priceKey } from "./modelPicker.js";

const M = (id, provider, out, extra = {}) => ({ id, label: id, provider, cost: "Low", speed: "Fast", price: { in: 1, out }, availability: { state: "ok" }, ...extra });
const models = [
  M("g-pro", "gemini", 12, { speed: "Slower", cost: "High" }),
  M("g-lite", "gemini", 0.4, { speed: "Fastest", cost: "Lowest" }),
  M("o-mini", "openai", 0.6),
  M("c-haiku", "anthropic", 0.5, { speed: "Fastest" }),
  M("g-dead", "gemini", 0.1, { availability: { state: "unavailable" } }),
];

describe("arrangeModels", () => {
  it("groups by provider in Gemini / OpenAI / Claude order and hides retired by default", () => {
    const g = arrangeModels(models);
    expect(g.map((x) => x.prov)).toEqual(["gemini", "openai", "anthropic"]);
    expect(g[0].models.map((m) => m.id)).toEqual(["g-pro", "g-lite"]);
    expect(arrangeModels(models, { showRetired: true })[0].models.map((m) => m.id)).toContain("g-dead");
  });
  it("keeps a retired model visible when it is the current selection", () => {
    expect(arrangeModels(models, { keepId: "g-dead" })[0].models.map((m) => m.id)).toContain("g-dead");
  });
  it("sorts cheapest, fastest and best-quality within each provider", () => {
    expect(arrangeModels(models, { sort: "cheapest" })[0].models[0].id).toBe("g-lite");
    expect(arrangeModels(models, { sort: "fastest" })[0].models[0].id).toBe("g-lite");
    expect(arrangeModels(models, { sort: "quality" })[0].models[0].id).toBe("g-pro");
  });
  it("searches id, label, provider name and notes", () => {
    expect(arrangeModels(models, { query: "claude" }).flatMap((g) => g.models).map((m) => m.id)).toEqual(["c-haiku"]);
    expect(arrangeModels(models, { query: "nothing-here" })).toEqual([]);
  });
});

describe("badges and availability", () => {
  it("flags the cheapest usable model only", () => {
    expect([...cheapestIds(models)]).toEqual(["g-lite"]); // g-dead is cheaper but retired
    expect(isRetired(models[4])).toBe(true);
  });
  it("explains a model whose key is missing or whose provider is not allowed", () => {
    expect(disabledReason(models[3], { keys: { anthropic: false } })).toMatch(/ANTHROPIC_API_KEY/);
    expect(disabledReason(models[2], { allowed: ["gemini"] })).toMatch(/can't run on OpenAI/);
    expect(disabledReason(models[0], { keys: { gemini: true }, allowed: ["gemini"] })).toBe("");
    expect(disabledReason(models[0], {})).toBe("");
  });
  it("formats price chips", () => {
    expect(priceChip({ price: { in: 0.3, out: 2.5 } })).toBe("$0.30 in / $2.50 out");
    expect(priceChip({ price: { perImage: 0.0336 } })).toBe("$0.0336 / image");
    expect(priceChip({ price: { perMChars: 15 } })).toBe("$15.00 / 1M chars");
    expect(priceKey({})).toBe(Infinity);
  });
});
