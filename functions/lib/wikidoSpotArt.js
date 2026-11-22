// Spot-aware artwork prompts for Wikido scenes. Pure functions, no dependencies:
// shared by the Cloud Functions (image generation) and the web Studio (the
// "What the artwork will include" preview), so both always agree.
//
// A scene's picture must depict every spot WHERE its pin sits. So the prompt
// carries, per spot: a concrete visual subject, what the card teaches, the
// child-scene title (if the spot is a doorway) and the position in plain layout
// language. Abstract labels ("India", "Culture") are turned into a depictable
// symbol — deterministic rules first, then (server side) the text model, and the
// result is stored on the spot as `visual` so it is reused and editable.

// ── position → layout language ───────────────────────────────────────────────
// x: % across (0 left), y: % down (0 top).
export function positionPhrase(x, y) {
  const nx = Number(x);
  const ny = Number(y);
  const fx = Number.isFinite(nx) ? nx : 50;
  const fy = Number.isFinite(ny) ? ny : 50;
  const horiz = fx < 38 ? "left" : fx <= 62 ? "centre" : "right";
  const depth = fy < 30 ? "upper" : fy <= 62 ? "middle" : "lower";
  const plane = fy < 30 ? "background" : fy <= 62 ? "mid-ground" : "foreground";
  if (horiz === "centre" && depth === "middle") return "centre, mid-ground";
  if (horiz === "centre") return `${depth} centre, ${plane}`;
  if (depth === "middle") return `${horiz}, mid-ground`;
  return `${depth}-${horiz}, ${plane}`;
}

// ── abstract label → depictable symbol ───────────────────────────────────────
// Deliberately small and opinionated: places (countries/continents) become a
// landmark, broad themes become a concrete scene. Anything not listed falls
// through to the text model (server) or the label itself.
const SYMBOLS = {
  india: "the Taj Mahal, white marble domes and minarets",
  china: "a section of the Great Wall winding over green hills",
  pakistan: "the Badshahi Mosque in Lahore with its red sandstone domes",
  japan: "Mount Fuji with a red pagoda in the foreground",
  egypt: "the Great Pyramids of Giza with a camel caravan",
  italy: "the Colosseum in Rome",
  france: "the Eiffel Tower",
  germany: "a fairytale castle (Neuschwanstein) among Alpine woods",
  spain: "the towers of the Sagrada Família",
  greece: "the Parthenon on the Acropolis",
  turkey: "the Blue Mosque and its minarets",
  uk: "Big Ben and the Elizabeth Tower",
  "united kingdom": "Big Ben and the Elizabeth Tower",
  england: "Big Ben and the Elizabeth Tower",
  russia: "the colourful onion domes of St Basil's Cathedral",
  brazil: "Christ the Redeemer statue above Rio de Janeiro",
  peru: "the ruins of Machu Picchu among green peaks",
  mexico: "the stepped pyramid of Chichén Itzá",
  usa: "the Statue of Liberty",
  "united states": "the Statue of Liberty",
  canada: "a moose beside a mountain lake with pine forest",
  australia: "the Sydney Opera House and a kangaroo",
  indonesia: "a terraced rice field below a smoking volcano",
  thailand: "a gilded Buddhist temple with a tall golden spire",
  nepal: "a prayer-flag-draped Himalayan peak",
  "saudi arabia": "golden desert dunes with a lone date palm and a sandstone fort",
  morocco: "a blue-walled medina alley with a camel",
  kenya: "an acacia tree on the savanna with elephants",
  "south africa": "Table Mountain above Cape Town",
  asia: "a sweeping Asian landscape of a snowy Himalayan peak",
  africa: "an African savanna with acacia trees and a herd of elephants",
  europe: "a European old-town square with a cathedral",
  culture: "traditional costumes, a musical instrument and a festival lantern",
  history: "ancient stone ruins and a weathered carved monument",
  food: "a market table piled with local dishes, fruit and spices",
  cuisine: "a market table piled with local dishes, fruit and spices",
  people: "a group of smiling villagers in traditional dress",
  nature: "a lush forest valley with a waterfall",
  wildlife: "a large wild animal characteristic of the region standing in its habitat",
  geography: "a rugged mountain range with a winding river below",
  climate: "storm clouds breaking into sunshine over a landscape",
  economy: "a busy harbour market with cargo crates and boats",
  religion: "a place of worship with an open doorway and a lamp",
  art: "a hand-painted mural and a potter's shaped clay vase",
  music: "traditional musicians playing stringed and drum instruments",
  language: "an open old book with calligraphy on a wooden table",
  science: "a telescope on a hill under a starry sky",
  technology: "a gleaming modern city skyline with a high-speed train",
  sports: "a stadium with players mid-action",
  animals: "a large wild animal characteristic of the region standing in its habitat",
  plants: "a flowering tree and ferns in a sunlit clearing",
};

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

// A symbol for an abstract label, or "" when the label is already depictable
// (or unknown — the caller then asks the text model or uses the label as is).
export function deterministicVisual(label) {
  const key = norm(label);
  if (!key) return "";
  if (SYMBOLS[key]) return SYMBOLS[key];
  // "Culture of India", "India's culture", "Food in Pakistan" → the theme symbol
  for (const word of key.split(" ")) {
    if (SYMBOLS[word] && ["culture", "history", "food", "cuisine", "people", "nature", "wildlife", "geography", "climate", "economy", "religion", "art", "music", "language", "science", "technology", "sports", "animals", "plants"].includes(word)) {
      return SYMBOLS[word];
    }
  }
  return "";
}

const MAX_VISUAL = 140;
function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t;
}

// What this spot should look like in the picture: the curator's / agent's stored
// `visual`, else a deterministic symbol, else the spot's own label.
export function spotVisual(spot) {
  const stored = clip(spot?.visual, MAX_VISUAL);
  if (stored) return stored;
  const sym = deterministicVisual(spot?.label);
  if (sym) return sym;
  return clip(spot?.label, 80);
}

// True when nothing but the bare label would be used — the server then asks the
// text model for a concrete subject (once; the answer is stored on the spot).
export function needsVisualSuggestion(spot) {
  return !String(spot?.visual || "").trim() && !deterministicVisual(spot?.label);
}

// Read-only rows for the Studio preview: spot → visual subject → position.
export function describeSpots(scene, scenes = {}) {
  return (scene?.hotspots || []).map((h, i) => ({
    id: h.id,
    n: i + 1,
    label: String(h.label || ""),
    visual: spotVisual(h),
    stored: !!String(h.visual || "").trim(),
    position: positionPhrase(h.x, h.y),
    childTitle: h.childSceneId ? String(scenes?.[h.childSceneId]?.title || "") : "",
  }));
}

// Copy stored visuals (id → text) onto a scene's spots; returns how many changed.
// Used after the server persisted new visuals so the Studio form keeps them.
export function mergeVisuals(scene, visuals) {
  let n = 0;
  for (const h of scene?.hotspots || []) {
    const v = visuals?.[h.id];
    if (typeof v === "string" && v.trim() && h.visual !== v) { h.visual = v; n++; }
  }
  return n;
}

// ── the prompt section ───────────────────────────────────────────────────────
const MAX_SPOTS = 14;
const MAX_SECTION = 3200; // chars; image models take far more, this keeps the subject list sharp

export function buildSpotArtDirection(spots = [], { scenes = {} } = {}) {
  const list = (spots || []).filter((h) => h && String(h.label || "").trim()).slice(0, MAX_SPOTS);
  if (!list.length) return "";
  const lines = list.map((h) => {
    const visual = spotVisual(h);
    const teaches = clip(h.info?.body?.[0] || h.blurb || h.info?.title || "", 140);
    const childTitle = h.childSceneId ? String(scenes?.[h.childSceneId]?.title || "").trim() : "";
    const parts = [`- At the ${positionPhrase(h.x, h.y)}: ${visual}.`];
    if (String(h.label).trim().toLowerCase() !== visual.toLowerCase()) parts.push(`(Represents "${clip(h.label, 60)}".)`);
    if (teaches) parts.push(`It illustrates: ${teaches}`);
    if (childTitle) parts.push(`Visitors can step inside to "${clip(childTitle, 60)}".`);
    return parts.join(" ");
  });
  let body = lines.join("\n");
  while (body.length > MAX_SECTION && lines.length > 1) {
    // over budget: shorten the longest remaining line's teaching sentence first
    const i = lines.reduce((best, l, k) => (l.length > lines[best].length ? k : best), 0);
    const cut = lines[i].replace(/ It illustrates:.*?(?= Visitors can| $|$)/, "");
    if (cut === lines[i]) break;
    lines[i] = cut;
    body = lines.join("\n");
  }
  return (
    "SUBJECTS AND WHERE THEY GO — the picture must clearly depict every subject below, each at the position given " +
    "(these positions override any left/right layout hints above). Every subject must be large enough to recognise at a glance, " +
    "kept distinct and separate from the others with clear space around it so nothing overlaps or hides another. " +
    "Do not draw any text, labels, captions, numbers, dots or markers anywhere in the picture:\n" +
    body
  );
}

// ── text-model step (server only supplies the call; these are pure) ──────────
export function buildVisualSuggestionPrompt({ sceneTitle = "", spots = [] }) {
  const items = spots.map((h) => ({
    id: h.id,
    label: h.label,
    teaches: clip(h.info?.body?.[0] || h.blurb || "", 140),
  }));
  return (
    `You are an art director for a children's picture encyclopedia. The scene "${sceneTitle}" has spots that must each be ` +
    `DRAWN as one concrete, instantly recognisable thing. For each spot decide a "visual": a short noun phrase (under 15 words) ` +
    `naming something a painter can draw. If the label is already a concrete object, animal or landmark, keep it (add one helpful detail). ` +
    `If it is abstract — a country, region, theme, idea — pick ONE iconic symbol of it (India → the Taj Mahal; Culture → a festival lantern and traditional instrument). ` +
    `Never include text, flags with writing, or people's faces in focus.\n\nSpots:\n${JSON.stringify(items, null, 2)}\n\n` +
    `Output ONLY JSON: {"visuals": [{"id": "spot-id", "visual": "..."}]}`
  );
}

export function normalizeVisualSuggestions(parsed, spots = []) {
  const ids = new Set(spots.map((h) => h.id));
  const out = {};
  for (const v of Array.isArray(parsed?.visuals) ? parsed.visuals : []) {
    const id = String(v?.id || "");
    const text = clip(v?.visual, MAX_VISUAL);
    if (ids.has(id) && text) out[id] = text;
  }
  return out;
}
