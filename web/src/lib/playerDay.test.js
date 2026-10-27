import { describe, it, expect } from "vitest";
import { shiftDateKey, friendlyDay } from "./playerDay";

describe("playerDay", () => {
  it("steps across month and year ends", () => {
    expect(shiftDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("names nearby days in plain words", () => {
    expect(friendlyDay("2026-10-27", "2026-10-27")).toBe("Today");
    expect(friendlyDay("2026-10-28", "2026-10-27")).toBe("Tomorrow");
    expect(friendlyDay("2026-10-26", "2026-10-27")).toBe("Yesterday");
    expect(friendlyDay("2026-10-30", "2026-10-27")).toMatch(/Fri/);
  });
});
