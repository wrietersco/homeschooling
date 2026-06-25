// Single source of truth for the "today" line embedded into every agent's system
// instructions. Agents run server-side, so new Date() at call time is the
// authoritative current date — this anchors all date, scheduling, age, and
// deadline reasoning instead of letting the model guess from its training cutoff.

// A one-line, human + ISO date statement in UTC.
export function currentDateContext(now = new Date()) {
  const iso = now.toISOString().slice(0, 10);
  const human = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
  return `CURRENT DATE: Today is ${human} (${iso}, UTC). Treat this as "today" for all date, scheduling, age, and deadline reasoning.`;
}

// Prepend the current-date line to a system prompt. Safe on empty/undefined input
// (returns just the date line). Used wherever a system prompt is handed to the LLM.
export function withCurrentDate(system, now = new Date()) {
  const line = currentDateContext(now);
  return system ? `${line}\n\n${system}` : line;
}
