import { describe, it, expect } from "vitest";
import { hourLabel, dayPeriod, hourOf, withHour, bucketByHour, firstBusyHour, HOURS } from "./plannerGrid";

describe("plannerGrid", () => {
  it("covers the whole day in hourly buckets", () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe(0);
    expect(HOURS[23]).toBe(23);
  });

  it("labels hours in 12-hour form", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(15)).toBe("3 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });

  it("maps hours to a sky period", () => {
    expect(dayPeriod(2)).toBe("night");
    expect(dayPeriod(6)).toBe("dawn");
    expect(dayPeriod(10)).toBe("day");
    expect(dayPeriod(17)).toBe("dusk");
    expect(dayPeriod(21)).toBe("night");
  });

  it("reads and rewrites the hour of a time, keeping minutes", () => {
    expect(hourOf("09:30")).toBe(9);
    expect(hourOf("")).toBe(9);
    expect(hourOf("garbage")).toBe(9);
    expect(withHour("09:30", 14)).toBe("14:30");
    expect(withHour("", 7)).toBe("07:00");
  });

  it("buckets blocks by hour, sorted by time", () => {
    const b = bucketByHour([
      { id: "c", scheduledTime: "10:45" },
      { id: "a", scheduledTime: "09:00" },
      { id: "b", scheduledTime: "10:15" },
    ]);
    expect(Object.keys(b)).toEqual(["9", "10"]);
    expect(b[10].map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("opens at the earliest busy hour, never later than 8 AM", () => {
    expect(firstBusyHour({})).toBe(8);
    expect(firstBusyHour({ d: [{ scheduledTime: "11:00" }] })).toBe(8);
    expect(firstBusyHour({ d: [{ scheduledTime: "06:30" }], e: [{ scheduledTime: "10:00" }] })).toBe(6);
  });
});
