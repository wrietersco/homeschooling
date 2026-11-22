// Pure helpers behind the "Add a place to the globe" wizard and the per-place
// status checklist. No Vue, no network — everything here is unit-tested.
import {
  cities, countries, placeCatalog, resolvePlaceQuery, slugName,
} from "../../../../functions/lib/wikidoGazetteer.js";

const ART_RE = /^(https?:\/\/|\/wikido\/)/;
const hasArt = (scene) => ART_RE.test(String(scene?.image?.src || ""));

export const PLACE_KINDS = [
  { id: "continent", emoji: "🗺️", label: "Continent", help: "A huge landmass, like Africa or Asia." },
  { id: "country", emoji: "🌍", label: "Country", help: "A nation, like Pakistan or Japan." },
  { id: "city", emoji: "🏙️", label: "City", help: "A town or city, like Lahore or Cairo." },
  { id: "landmark", emoji: "📍", label: "Landmark", help: "A famous place, like the Eiffel Tower." },
];

// hub-spot level for each kind of place
export const levelForKind = (kind) => (kind === "landmark" ? "location" : kind);
export const kindForLevel = (level) => (level === "location" ? "landmark" : level || "city");

// The steps a place goes through, in order. A place whose coordinates we do not
// know yet (a landmark the gazetteer has never heard of) is located WHILE its
// scene is written, so "check the spot" comes after "make its scene".
export function stepOrder(located) {
  return located
    ? ["kind", "pick", "spot", "scene", "on"]
    : ["kind", "pick", "scene", "spot", "on"];
}

export const STEP_TITLES = {
  kind: "What kind of place?",
  pick: "Which one?",
  spot: "Check the spot",
  scene: "Make its scene",
  on: "Turn it on for children",
};

// Status of ONE hub place — what is done and what is still missing.
//   → { pinned, scene, artwork, voice, on, missing: [..], complete, firstStep }
export function placeChecklist(pack, spot) {
  const child = spot?.childSceneId ? pack?.scenes?.[spot.childSceneId] : null;
  const scene = Boolean(child);
  const artwork = scene && hasArt(child);
  const voice = scene && Boolean(child.audio) && Boolean(spot.audio);
  const on = spot?.enabled !== false;
  const missing = [];
  if (!scene) missing.push("scene");
  if (scene && !artwork) missing.push("artwork");
  if (scene && !voice) missing.push("voice");
  if (!on) missing.push("on");
  // where "Finish this place" reopens the wizard
  const firstStep = scene ? "on" : "scene";
  return { pinned: true, scene, artwork, voice, on, missing, complete: missing.length === 0, firstStep };
}

// What the finish screen says is still left, in plain words.
export function leftToDo(check) {
  const out = [];
  if (!check.scene) out.push("Write its scene — without one it cannot be switched on.");
  if (check.scene && !check.artwork) out.push("Paint its artwork (optional, but pictures make it come alive).");
  if (check.scene && !check.voice) out.push("Record its voice (optional — children can still read it).");
  if (!check.on) out.push("Switch it on so children can see it.");
  return out;
}

// Catalog places by kind, each tagged with whether the globe already has them.
//   directory rows come from globeDirectory(pack): { place, spot, state }
export function catalogChoices(directory, kind, query = "") {
  const q = query.trim().toLowerCase();
  return directory
    .filter((row) => row.place.level === kind)
    .filter((row) => !q || row.place.name.toLowerCase().includes(q))
    .map((row) => ({ ...row, added: row.state !== "unadded" }));
}

export const allCountries = [...countries].sort((a, b) => a.name.localeCompare(b.name));

// Gazetteer cities of one country, filtered by what has been typed.
export function cityChoices(countryId, query = "") {
  const q = query.trim().toLowerCase();
  return cities
    .filter((c) => c.country === countryId)
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.capital) - Number(a.capital) || a.name.localeCompare(b.name));
}

// Resolve a typed city/landmark to coordinates the gazetteer already knows, so
// its pin can be checked BEFORE the scene is written. Null → the model finds
// it while writing the scene.
export function locatePlace(kind, name, countryId) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  if (kind === "city" && countryId) {
    const hit = cities.find((c) => c.country === countryId && slugName(c.name) === slugName(clean));
    if (hit) return { name: hit.name, lat: hit.lat, lng: hit.lng, level: "city", countryId };
  }
  const found = resolvePlaceQuery(clean);
  if (found && found.level !== "continent" && found.level !== "country") {
    return { name: found.name, lat: found.lat, lng: found.lng, level: found.level, countryId: found.country?.id || countryId };
  }
  return null;
}

// What to hand the "write the scene" agent. A known name goes through as-is
// (the gazetteer matches exact names); anything else carries its country so the
// model does not have to guess which Springfield is meant.
export function sceneQuery({ kind, name, countryName, located }) {
  if (kind === "continent" || kind === "country" || located) return name;
  return countryName ? `${name}, ${countryName}`.slice(0, 80) : name;
}

// Make a catalog entry or located place into a hub spot id the backend will
// recognise (same slug the "Pin a place" agent uses).
export const spotIdFor = (name) => slugName(name);

export { placeCatalog };

// Turn a server/Firebase error into one calm sentence a beginner can act on.
export function friendlyError(e, fallback = "Something went wrong. Please try again.") {
  const raw = String(e?.message || e || "").replace(/^(internal|invalid-argument|failed-precondition|not-found|permission-denied|unauthenticated): /, "").trim();
  if (!raw) return fallback;
  if (/already pinned/i.test(raw)) return "That place is already on your globe — pick it from the list instead of adding it again.";
  if (/GEMINI_API_KEY|API key/i.test(raw)) return "The writing assistant is not set up yet (its key is missing). Ask the platform owner to add it, or choose “Add without a scene for now”.";
  if (/could not be pinned/i.test(raw)) return `${raw} Try the full name, or check the country you chose.`;
  if (/deadline|timeout|timed out/i.test(raw)) return "That took too long. Nothing was lost — press Try again.";
  if (/network|failed to fetch|unavailable/i.test(raw)) return "Could not reach the server. Check your internet connection and press Try again.";
  if (/unreachable from root/i.test(raw)) return "Your last edits could not be saved (a scene is not linked to the map). Close this, press “Re-link misplaced scenes”, then try again.";
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}
