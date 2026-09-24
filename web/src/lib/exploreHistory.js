// Rendering helpers for the buddy's own session notes.
//
// The highlights the buddy files are free-shaped on purpose — a speech lesson and
// a maths lesson record different things — so the panel can't assume a schema. It
// renders whatever keys came back, which is what these helpers turn into
// something a parent can read at a glance.

export const MODE_LABELS = { explore: "Exploration", learn: "Learning" };

// "Today" / "Yesterday" / "3 days ago" / a date. Parents think in "last time",
// not timestamps.
export function whenLabel(d, now = new Date()) {
  if (!d) return "";
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

// One highlight object → readable label/value pairs. Keys are snake_case from the
// model; values may be numbers, booleans, arrays or nested detail.
export function highlightPairs(h = {}) {
  return Object.entries(h)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      key: k.replace(/_/g, " "),
      value: Array.isArray(v)
        ? v.join(", ")
        : typeof v === "boolean"
          ? (v ? "yes" : "no")
          : v && typeof v === "object"
            ? Object.entries(v).map(([ik, iv]) => `${ik.replace(/_/g, " ")}: ${iv}`).join(", ")
            : String(v),
    }));
}
