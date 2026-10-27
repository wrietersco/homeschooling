// Day helpers for the Activity Player's day switcher: step a "YYYY-MM-DD" key by
// whole days, and name it the way a parent says it ("Today", "Tomorrow", "Fri 30 Oct").
const pad = (n) => String(n).padStart(2, "0");
const parse = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const keyOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

export function shiftDateKey(key, days) {
  const dt = parse(key);
  dt.setDate(dt.getDate() + days);
  return keyOf(dt);
}

export function friendlyDay(key, todayKey) {
  if (key === todayKey) return "Today";
  if (key === shiftDateKey(todayKey, 1)) return "Tomorrow";
  if (key === shiftDateKey(todayKey, -1)) return "Yesterday";
  return parse(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
