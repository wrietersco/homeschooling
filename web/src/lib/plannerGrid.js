// Pure helpers for the hour-bucket planner matrix. Blocks store their start as
// "HH:MM" (24h); the grid only shows the hour bucket, so the minutes ride along
// untouched when a card is dragged to another hour.

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

// "9 AM", "12 PM", "12 AM" — the only time text a parent ever reads.
export function hourLabel(h) {
  const suffix = h < 12 ? "AM" : "PM";
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${suffix}`;
}

// Which sky picture sits beside an hour: night moon, sunrise, sun, sunset.
export function dayPeriod(h) {
  if (h < 5 || h >= 20) return "night";
  if (h < 8) return "dawn";
  if (h < 16) return "day";
  return "dusk";
}

export function hourOf(time) {
  const h = parseInt(String(time || "").split(":")[0], 10);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : 9;
}

// Move a "HH:MM" into another hour, keeping its minutes.
export function withHour(time, hour) {
  const m = String(time || "").split(":")[1];
  const mm = /^\d{2}$/.test(m || "") ? m : "00";
  return `${String(hour).padStart(2, "0")}:${mm}`;
}

// { [hour]: [block, ...] } for one day, ordered by time within each hour.
export function bucketByHour(blocks) {
  const out = {};
  for (const b of [...(blocks || [])].sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)))) {
    (out[hourOf(b.scheduledTime)] ||= []).push(b);
  }
  return out;
}

// The hour the grid should open scrolled to: the earliest planned hour this
// week, else 8 AM (never past it, so the morning is always in view).
export function firstBusyHour(dayBlocks) {
  let first = 24;
  for (const blocks of Object.values(dayBlocks || {})) {
    for (const b of blocks || []) first = Math.min(first, hourOf(b.scheduledTime));
  }
  return Math.min(first, 8);
}
