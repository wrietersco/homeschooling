// Wikido Perspectives — the lenses a scene can be seen through (History,
// Culture, Architecture, Food, a Map…). Shared by the web app and the
// functions: the catalog, the scene-graph helpers every walker uses, and the
// kind/ranking logic behind the studio's recommendations. Pure — no I/O.
//
// Data model (see docs/wikido-perspectives.md): a lens is an ordinary scene
// with `perspectiveOf: <baseSceneId>` and `lens: <catalog id>`; its base scene
// lists it in `perspectives: [{ id, sceneId }]`. A scene without `perspectives`
// is simply its own single "Overview" lens — no migration.

export const MAIN_LENS = "main";
export const MAX_LENSES_PER_SCENE = 12;

// kinds a scene can be: what it is ABOUT decides which lenses suit it
export const SCENE_KINDS = ["country", "region", "city", "landmark", "topic"];
const PLACE_KINDS = new Set(["country", "region", "city", "landmark"]);

// The Overview — the base scene itself. Not in the catalog list (it is never
// "added"), but chips and URLs use it.
export const OVERVIEW_LENS = Object.freeze({
  id: MAIN_LENS,
  name: "Overview",
  emoji: "🔭",
  color: "#3b82f6",
  description: "The big picture — a little of everything.",
});

// p(id, name, emoji, color, group, bestFor, description, spots, art)
const p = (id, name, emoji, color, group, bestFor, description, spots, art) =>
  Object.freeze({ id, name, emoji, color, group, bestFor: Object.freeze(bestFor), description, spots, art });

const ALL_PLACES = ["country", "region", "city", "landmark"];
const NATIONS = ["country", "region"];

export const PERSPECTIVE_GROUPS = Object.freeze([
  { id: "land", name: "Land & nature" },
  { id: "people", name: "People & culture" },
  { id: "past", name: "The past" },
  { id: "society", name: "How it works together" },
  { id: "ideas", name: "Ideas & achievements" },
  { id: "topic", name: "Any topic" },
]);

export const PERSPECTIVES = Object.freeze([
  // ── Land & nature ───────────────────────────────────────────────────────────
  p("map", "Map", "🗺️", "#0ea5e9", "land", ["country", "region", "city"],
    "Where everything is — borders, cities, rivers and neighbours.",
    "Spots are places ON the map: the capital and big cities, major rivers, mountain ranges, coasts, neighbouring countries, one 'you are here' compass rose.",
    "An illustrated, top-down picture map of the area (like a children's atlas plate): clear land shapes, rivers, mountains as small relief drawings, little landmark icons at the cities. No dense text; at most a few large name labels."),
  p("geography", "Geography", "🏔️", "#16a34a", "land", NATIONS.concat("city"),
    "Mountains, rivers, deserts, coasts — the shape of the land.",
    "Spots are landforms and waters: the highest mountain, the longest river, a desert or plain, a coast or lake, a valley people live in, and why each matters.",
    "A sweeping panoramic landscape cross-section from mountains to sea, each landform clearly separated so it can be pointed at."),
  p("landscapes", "Landscapes & nature", "🌿", "#22c55e", "land", ALL_PLACES,
    "The most beautiful wild places and natural wonders.",
    "Spots are natural wonders and habitats: forests, waterfalls, wetlands, caves, famous national parks, seasonal sights (blossom, snow).",
    "A lush, true-to-life nature panorama showing several distinct habitats side by side, golden-hour light."),
  p("climate", "Weather & climate", "⛅", "#38bdf8", "land", NATIONS.concat("city"),
    "Hot or cold, rainy or dry — and how seasons change life.",
    "Spots are weather and seasons: the hottest/coldest place, monsoon or snow season, a typical sky, how people dress and farm for the weather, a climate change effect.",
    "A picture split into seasons or climate zones across the land, with visible weather (sun, rain, snow, wind) in each part."),
  p("wildlife", "Animals & plants", "🐅", "#f59e0b", "land", ALL_PLACES.concat("topic"),
    "The animals and plants that live here.",
    "Spots are living things: the national animal and bird, a rare or endangered species, a famous plant or tree, a sea creature, an insect, and where each lives.",
    "A natural habitat scene with each animal and plant clearly visible and life-size relative to each other, documentary-illustration realism."),
  p("environment", "Caring for nature", "♻️", "#10b981", "land", ALL_PLACES.concat("topic"),
    "Protecting nature, clean energy and big green ideas.",
    "Spots are conservation stories: a protected park, a species being saved, clean energy (solar, wind, hydro), a pollution problem and its fix, what children can do.",
    "A hopeful scene contrasting a protected, thriving area with people actively restoring nature; bright, optimistic."),

  // ── People & culture ───────────────────────────────────────────────────────
  p("people", "People & character", "🧑‍🤝‍🧑", "#ec4899", "people", NATIONS.concat("city"),
    "Who lives here and what they value — kindness, family, hospitality.",
    "Spots are people and values: family life, how guests are welcomed, greetings and manners, what people are proud of, different groups who live together, a typical saying.",
    "A warm, respectful gathering of real-looking local people of different ages doing everyday kind things together; never caricatured."),
  p("languages", "Languages", "🗣️", "#a855f7", "people", NATIONS.concat("city"),
    "The languages people speak and the scripts they write.",
    "Spots are languages and words: the main languages, the writing script(s), how to say hello and thank you, a famous word given to the world, regional languages.",
    "A friendly street or classroom scene with signs, books and speech bubbles showing the real scripts (short, correct words only)."),
  p("beliefs", "Religions & beliefs", "🕌", "#14b8a6", "people", ALL_PLACES,
    "What people believe and the places where they pray.",
    "Spots are faiths and practices, described respectfully and factually: places of worship, holy days, prayer and charity customs, a famous religious building, how different faiths live side by side.",
    "Calm, respectful scene of real places of worship and people in quiet practice; no depictions of prophets or sacred figures."),
  p("culture", "Culture & traditions", "🎎", "#f97316", "people", ALL_PLACES,
    "Customs, celebrations, clothing and ways of life.",
    "Spots are traditions: traditional clothing, a big festival, a wedding or family custom, a traditional game, crafts, music or dance, a greeting.",
    "A bright festival or market scene full of traditional clothing, decorations, crafts and people celebrating together."),
  p("festivals", "Festivals & holidays", "🎉", "#f43f5e", "people", NATIONS.concat("city"),
    "The special days everyone looks forward to.",
    "Spots are celebrations through the year: national day, religious festivals, harvest or new-year festivals, what people eat, wear and do on each.",
    "A joyful street celebration with lights, flags or lanterns, families and festival food."),
  p("food", "Food", "🍛", "#ef4444", "people", ALL_PLACES,
    "Favourite dishes, spices, fruits and how meals are shared.",
    "Spots are foods: the national dish, a street food, a sweet, a drink, an important crop or spice, how and where a meal is eaten together.",
    "An abundant, appetising table or bazaar spread with each dish clearly separated and recognisable, warm light."),
  p("clothing", "Clothes", "👘", "#d946ef", "people", NATIONS.concat("city"),
    "What people wear every day and on special days.",
    "Spots are garments and accessories: everyday clothes, festive dress, regional styles, headwear, footwear, a famous fabric or craft and why it suits the climate.",
    "A line-up or street scene of real people modelling everyday and traditional clothes with visible fabric detail."),
  p("arts", "Arts & music", "🎨", "#8b5cf6", "people", ALL_PLACES,
    "Painting, poetry, music, dance and crafts.",
    "Spots are art forms: a famous instrument, a music style, a dance, a poet or storyteller tradition, a craft (pottery, carpets, calligraphy), a famous artwork or museum.",
    "A lively artists' quarter or stage scene where each art form is being performed or made."),
  p("stories", "Myths & legends", "🐉", "#6366f1", "people", ALL_PLACES,
    "Folk tales and legends told to children here.",
    "Spots are stories: famous folk tales, legendary heroes, magical creatures from local legends, a fable's lesson, where the story is said to have happened.",
    "A storybook-like but realistic scene of the land with the legends' characters subtly placed into it, soft dreamy light."),
  p("daily-life", "Daily life", "🏡", "#84cc16", "people", NATIONS.concat("city"),
    "A day in the life — home, school, market and play.",
    "Spots are everyday moments: a typical home, breakfast, the way to school, the market, a job many people do, evening family time, bedtime.",
    "A cut-away street of homes, shops and a school showing a full day's activities at once."),
  p("school", "School & childhood", "🎒", "#facc15", "people", NATIONS.concat("city"),
    "What children learn and play here.",
    "Spots are childhood: a classroom, the school uniform, a favourite subject, playground games, children's chores, a children's book or cartoon.",
    "A cheerful schoolyard and classroom scene with children of the place learning and playing."),

  // ── The past ───────────────────────────────────────────────────────────────
  p("history", "History", "📜", "#b45309", "past", ALL_PLACES.concat("topic"),
    "The great story of the past — from long ago to today.",
    "Spots are moments in time, oldest to newest: earliest people, an ancient civilisation or kingdom, a golden age, a turning point, how it became what it is today — each a clear event or era.",
    "A timeline panorama flowing left (oldest) to right (newest), each era shown by its buildings, clothing and objects; museum-plate realism."),
  p("geo-history", "Land & history", "🧭", "#a16207", "past", NATIONS.concat("city"),
    "How rivers, mountains and seas shaped what happened here.",
    "Spots link land to events: a river that grew a civilisation, a mountain pass armies or traders crossed, a coast that brought sailors, a desert that protected, trade routes.",
    "An illustrated relief map with historical scenes placed where they happened (caravans on routes, cities on rivers)."),
  p("political-history", "Kings, leaders & nations", "👑", "#92400e", "past", NATIONS,
    "Rulers, empires, independence and how the nation was born.",
    "Spots are political turning points: early kingdoms or empires, a famous ruler, colonial times if any, independence or unification, the founding leaders, the constitution.",
    "A grand historical tableau of palaces, coronations and independence scenes in sequence, dignified and accurate."),
  p("cultural-history", "How culture grew", "🏺", "#c2410c", "past", ALL_PLACES,
    "How language, arts, faith and customs developed over time.",
    "Spots trace culture through time: ancient crafts and writing, the arrival of a faith or language, a golden age of art or poetry, a famous book, modern culture.",
    "A museum gallery-like scene where objects from each era stand in order, lit softly."),
  p("archaeology", "Ancient ruins", "⛏️", "#78350f", "past", ALL_PLACES,
    "Ruins, digs and treasures from ancient times.",
    "Spots are archaeological finds: an ancient city or ruin, a dig site, a famous artefact, ancient writing, tools and pottery, what they tell us.",
    "An excavation site with ruins and archaeologists, artefacts visible in the soil and on tables; dusty sunlight."),
  p("architecture", "Architecture", "🏛️", "#64748b", "past", ALL_PLACES,
    "Famous buildings — how and why they were built.",
    "Spots are buildings and building ideas: the most famous landmark, a place of worship, a fort or palace, a traditional house, a modern skyscraper or bridge, a special material or decoration.",
    "A skyline or architectural panorama gathering the landmark buildings side by side, accurate proportions and details, clear daylight."),

  // ── How it works together ──────────────────────────────────────────────────
  p("government", "Government", "⚖️", "#1d4ed8", "society", NATIONS.concat("city"),
    "Who makes the rules and how leaders are chosen.",
    "Spots explain government simply: the head of state, parliament, elections and voting, courts and laws, the flag and anthem, local councils.",
    "A civic square with the parliament, courthouse, voting station and flag; people taking part; clear and neutral."),
  p("economy", "Money & work", "💰", "#ca8a04", "society", NATIONS.concat("city"),
    "Jobs, farms, factories, trade and the money people use.",
    "Spots are the economy: the currency, main crops and farms, factories and what they make, a port or market, famous products exported, jobs people do.",
    "A busy cut-away of fields, a factory, a port with ships and a market, showing goods moving."),
  p("transport", "Getting around", "🚆", "#0891b2", "society", NATIONS.concat("city"),
    "Trains, roads, boats and how people travel.",
    "Spots are ways of travelling: a famous railway, buses or rickshaws, a big airport, ports and boats, roads over mountains, old ways like camels or carts.",
    "A connected transport scene: a train crossing a bridge, roads, a harbour and a plane above."),
  p("cities", "Cities & towns", "🏙️", "#475569", "society", NATIONS,
    "The capital and the biggest cities, and what each is known for.",
    "Spots are cities: the capital, the biggest city, a port city, an old historic town, a mountain town, what each is famous for.",
    "A collage-like panorama where each city is a distinct, recognisable cluster of its landmark buildings."),
  p("defence", "Defence & forts", "🛡️", "#334155", "society", NATIONS.concat("landmark"),
    "Forts, walls and how the land has been protected — calmly told.",
    "Spots are defence history told peacefully for children: famous forts and walls, ancient guards and armour, a navy or air force today, peacekeeping, a peace treaty. No violence or gore.",
    "Historic fortifications and a calm parade or museum scene; no fighting, no weapons in use."),

  // ── Ideas & achievements ───────────────────────────────────────────────────
  p("science", "Science & inventions", "🔬", "#0d9488", "ideas", ALL_PLACES.concat("topic"),
    "Discoveries, inventions and great thinkers.",
    "Spots are discoveries and inventions made here (or about this topic): famous scientists, inventions, an observatory or lab, a medical breakthrough, modern technology.",
    "A bright workshop-laboratory scene with inventions and instruments from different times on display."),
  p("famous-people", "Famous people", "🌟", "#eab308", "ideas", ALL_PLACES.concat("topic"),
    "Heroes, thinkers, artists and athletes from here.",
    "Spots are real people children can admire: a founder or leader, a scientist, a poet or writer, an athlete, an artist, a humanitarian — each with what they did. Never depict prophets.",
    "A dignified gallery of the people as portraits or doing what made them famous, period-accurate clothing."),
  p("sports", "Sports & games", "🏏", "#22d3ee", "ideas", NATIONS.concat("city"),
    "Favourite sports, traditional games and champions.",
    "Spots are sports: the most popular sport, a traditional game, a famous stadium, a champion, games children play in the street.",
    "A sunny sports ground and street-games scene with each sport clearly being played."),
  p("records", "Record breakers", "🏆", "#fb923c", "ideas", ALL_PLACES.concat("topic"),
    "The biggest, tallest, oldest and fastest.",
    "Spots are superlatives: the highest, longest, biggest, oldest, fastest or rarest things here or in this topic, each with its number.",
    "A playful but realistic scene placing the record-breaking things side by side for size comparison."),

  // ── Any topic (non-place subjects like the Human Body) ─────────────────────
  p("how-it-works", "How it works", "⚙️", "#2563eb", "topic", ["topic", "landmark"],
    "Step by step: what happens and why.",
    "Spots are the stages or mechanisms in order: what goes in, what happens at each step, what comes out, and why it matters.",
    "A clear cut-away or cross-section diagram-like illustration with each step visibly separated, left to right."),
  p("parts", "Parts & pieces", "🧩", "#7c3aed", "topic", ["topic", "landmark"],
    "What it is made of and what each part does.",
    "Spots are the parts: each major part or component, what it does, and how the parts work together.",
    "An exploded-view illustration where the parts float slightly apart, each clearly identifiable."),
  p("up-close", "Up close", "🔍", "#0284c7", "topic", ["topic", "landmark"],
    "Zoom in — the tiny details you can't see with your eyes.",
    "Spots are microscopic or close-up details: cells, textures, tiny structures, materials, hidden mechanisms.",
    "A macro / microscope-view picture with magnified details in sharp focus and a sense of scale."),
  p("life-cycle", "Life cycle", "🔄", "#16a34a", "topic", ["topic"],
    "Birth, growth and change over time.",
    "Spots are stages of a cycle in order: beginning, growth, changes, maturity, ending or renewal — the cycle closes back to the start.",
    "A circular arrangement of the stages around the picture, each stage clearly drawn."),
  p("discoveries", "How we found out", "💡", "#f59e0b", "topic", ["topic"],
    "The story of discovery — who learned what, and how.",
    "Spots are milestones in human understanding of the topic: early ideas, key discoverers, the tools they used, a big breakthrough, what scientists study today.",
    "A timeline of discoverers' workrooms from ancient to modern, each with its instruments."),
  p("around-the-world", "Around the world", "🌍", "#059669", "topic", ["topic"],
    "Where in the world you find it, and how it differs.",
    "Spots are places on Earth connected to the topic: where it is found, studied or celebrated, and how it differs from place to place.",
    "A world map or globe panorama with small illustrated vignettes at each place."),
  p("healthy-safe", "Staying healthy & safe", "🩺", "#e11d48", "topic", ["topic"],
    "Looking after it — and ourselves.",
    "Spots are care and safety tips children can act on: healthy habits, dangers to avoid, helpers (doctors, rangers), what to do in an emergency.",
    "A friendly everyday scene of children and helpers practising the safe, healthy habits."),
  p("fun-facts", "Amazing facts", "🤩", "#f472b6", "topic", ALL_PLACES.concat("topic"),
    "Surprising, wow-worthy facts.",
    "Spots are surprising true facts, each tied to one clear thing in the picture, with a number or comparison children can remember.",
    "A vivid, busy-but-clear scene where each surprising thing stands out."),
]);

const BY_ID = new Map(PERSPECTIVES.map((x) => [x.id, x]));
export const perspectiveById = (id) => (id === MAIN_LENS ? OVERVIEW_LENS : BY_ID.get(id) || null);
export const isPerspectiveId = (id) => BY_ID.has(id);

// ── defaults & ranking ────────────────────────────────────────────────────────
export const PLACE_DEFAULT_LENSES = Object.freeze(["history", "culture", "architecture"]);
export const TOPIC_DEFAULT_LENSES = Object.freeze(["how-it-works", "discoveries", "up-close"]);

export function defaultPerspectivesFor(kind) {
  return kind === "topic" || !PLACE_KINDS.has(kind) ? [...TOPIC_DEFAULT_LENSES] : [...PLACE_DEFAULT_LENSES];
}

// Curated "best first" order per kind; anything else follows by bestFor match.
const FEATURED = {
  country: ["history", "culture", "architecture", "food", "map", "geography", "wildlife", "people", "beliefs", "languages", "famous-people", "festivals", "arts", "political-history", "economy", "government", "sports"],
  region: ["map", "geography", "history", "culture", "wildlife", "landscapes", "climate", "architecture", "food", "people", "languages", "beliefs", "geo-history"],
  city: ["history", "architecture", "culture", "food", "map", "daily-life", "transport", "famous-people", "arts", "festivals", "sports", "economy"],
  landmark: ["history", "architecture", "how-it-works", "parts", "culture", "stories", "famous-people", "archaeology", "records", "landscapes"],
  topic: ["how-it-works", "discoveries", "up-close", "parts", "life-cycle", "history", "fun-facts", "around-the-world", "healthy-safe", "science", "famous-people", "records", "wildlife", "environment"],
};

// The whole catalog ranked for a kind: featured first (in order), then the
// rest that list the kind in bestFor, then everything else. Every lens stays
// reachable — the ranking only decides what is shown first.
export function rankPerspectives(kind) {
  const k = SCENE_KINDS.includes(kind) ? kind : "topic";
  const featured = FEATURED[k] || [];
  const score = (x) => {
    const f = featured.indexOf(x.id);
    if (f >= 0) return f;
    return x.bestFor.includes(k) ? 100 : 1000;
  };
  return [...PERSPECTIVES]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => score(a.x) - score(b.x) || a.i - b.i)
    .map(({ x }) => ({ ...x, suits: x.bestFor.includes(k) || featured.includes(x.id) }));
}

// ── what a scene is about ─────────────────────────────────────────────────────
const LEVEL_KIND = { continent: "region", country: "country", city: "city", location: "landmark" };
const CITY_RE = /\b(city|town|capital|village|old town|downtown)\b/i;
const LANDMARK_RE = /\b(mosque|temple|church|cathedral|fort|palace|tower|wall|bridge|castle|pyramid|museum|monument|shrine|tomb|minaret|mausoleum|gate|dam|stadium)\b/i;
const REGION_RE = /\b(continent|region|asia|africa|europe|america|oceania|antarctica|middle east|arctic)\b/i;

// country | region | city | landmark | topic — explicit `scene.kind` wins,
// then the globe pin that opens the scene (its level), then the ancestor
// place for a globe world's deeper scenes (a mosque under Lahore = landmark),
// then title words. Picture worlds default to "topic".
export function sceneKind(pack, sceneId) {
  const scenes = pack?.scenes || {};
  const base = baseSceneId(scenes, sceneId);
  const scene = scenes[base];
  if (!scene) return "topic";
  if (SCENE_KINDS.includes(scene.kind)) return scene.kind;
  const title = String(scene.title || "");
  if (pack?.view === "globe") {
    const hub = scenes[pack.rootSceneId];
    const pin = (hub?.hotspots || []).find((h) => h.childSceneId === base && !h.childTopicId);
    if (pin && LEVEL_KIND[pin.level]) return LEVEL_KIND[pin.level];
    if (LANDMARK_RE.test(title)) return "landmark";
    if (CITY_RE.test(title)) return "city";
    return base === pack.rootSceneId ? "region" : "landmark";
  }
  if (LANDMARK_RE.test(title)) return "landmark";
  if (REGION_RE.test(title)) return "region";
  return "topic";
}

// ── scene-graph helpers (every walker uses these) ─────────────────────────────
const opensLocal = (h, packId = null) => Boolean(h?.childSceneId && !(h.childTopicId && h.childTopicId !== packId));

export const isPerspectiveScene = (scene) => Boolean(scene && typeof scene.perspectiveOf === "string" && scene.perspectiveOf);

// The lens entries of a scene that point at an existing scene, in order.
export function lensEntries(scene, scenes = null) {
  const list = Array.isArray(scene?.perspectives) ? scene.perspectives : [];
  return list.filter((e) => e && typeof e.sceneId === "string" && (!scenes || scenes[e.sceneId]));
}

// The scene a lens belongs to (itself for an ordinary scene).
export function baseSceneId(scenes, sceneId) {
  const s = scenes?.[sceneId];
  return isPerspectiveScene(s) && scenes[s.perspectiveOf] ? s.perspectiveOf : sceneId;
}

// Every scene this one leads to: its local doorways, then its lens scenes.
export function sceneChildIds(scene, packId = null) {
  const out = [];
  for (const h of Array.isArray(scene?.hotspots) ? scene.hotspots : []) if (opensLocal(h, packId)) out.push(h.childSceneId);
  for (const e of lensEntries(scene)) out.push(e.sceneId);
  return out;
}

// [{ id, sceneId, lens, scene }] — Overview first, then each existing lens.
export function sceneLenses(scenes, sceneId) {
  const baseId = baseSceneId(scenes, sceneId);
  const base = scenes?.[baseId];
  if (!base) return [];
  const out = [{ id: MAIN_LENS, sceneId: baseId, lens: OVERVIEW_LENS, scene: base }];
  for (const e of lensEntries(base, scenes)) {
    out.push({ id: e.id, sceneId: e.sceneId, lens: perspectiveById(e.id) || { ...OVERVIEW_LENS, id: e.id, name: e.id }, scene: scenes[e.sceneId] });
  }
  return out;
}

// A lens scene the child can actually use: painted, with spots.
export function isLensReady(scene) {
  const src = String(scene?.image?.src || "");
  return Boolean(src) && Array.isArray(scene?.hotspots) && scene.hotspots.length > 0;
}

// Validation of the perspective fields across a scenes map. Returns errors.
export function validatePerspectives(scenes, rootSceneId, { hubId = null } = {}) {
  const errors = [];
  if (!scenes || typeof scenes !== "object") return errors;
  const lensOwner = new Map(); // lens sceneId → base id
  for (const [id, scene] of Object.entries(scenes)) {
    if (scene?.perspectives === undefined) continue;
    const path = `scenes.${id}`;
    if (!Array.isArray(scene.perspectives)) { errors.push(`${path}: perspectives must be an array`); continue; }
    if (isPerspectiveScene(scene)) errors.push(`${path}: a perspective picture cannot have perspectives of its own`);
    if (hubId && id === hubId && scene.perspectives.length) errors.push(`${path}: the globe hub cannot have perspectives`);
    if (scene.perspectives.length > MAX_LENSES_PER_SCENE) errors.push(`${path}: at most ${MAX_LENSES_PER_SCENE} perspectives per scene`);
    const seen = new Set();
    for (const e of scene.perspectives) {
      const ep = `${path}.perspectives[${e?.id || "?"}]`;
      if (!e || !isPerspectiveId(e.id)) { errors.push(`${ep}: id must be a perspective from the catalog`); continue; }
      if (seen.has(e.id)) errors.push(`${ep}: this perspective is listed twice`);
      seen.add(e.id);
      const target = scenes[e.sceneId];
      if (!target) { errors.push(`${ep}: sceneId "${e.sceneId}" has no matching scene`); continue; }
      if (target.perspectiveOf !== id) errors.push(`${ep}: scene "${e.sceneId}" must say perspectiveOf "${id}"`);
      if (target.lens !== e.id) errors.push(`${ep}: scene "${e.sceneId}" must say lens "${e.id}"`);
      if (lensOwner.has(e.sceneId)) errors.push(`${ep}: scene "${e.sceneId}" is already a perspective of "${lensOwner.get(e.sceneId)}"`);
      lensOwner.set(e.sceneId, id);
    }
  }
  for (const [id, scene] of Object.entries(scenes)) {
    if (!isPerspectiveScene(scene)) continue;
    const path = `scenes.${id}`;
    if (id === rootSceneId) errors.push(`${path}: the entrance cannot be a perspective picture`);
    if (!isPerspectiveId(scene.lens)) errors.push(`${path}: lens must be a perspective from the catalog`);
    if (!scenes[scene.perspectiveOf]) errors.push(`${path}: perspectiveOf "${scene.perspectiveOf}" has no matching scene`);
    else if (lensOwner.get(id) !== scene.perspectiveOf) errors.push(`${path}: scene "${scene.perspectiveOf}" does not list this perspective`);
    for (const [sid, s] of Object.entries(scenes)) {
      if ((s?.hotspots || []).some((h) => h?.childSceneId === id && !h.childTopicId)) {
        errors.push(`scenes.${sid}: a spot opens the perspective picture "${id}" — open its scene "${scene.perspectiveOf}" instead`);
      }
    }
  }
  return errors;
}

// Child-loader repair: drop lenses that are not ready (no art / no spots) or
// broken (missing scene, wrong back-link, unknown lens). Returns a NEW scenes
// map, or the same object when nothing changed. The caller's reachability
// pass then removes the dropped lens scenes and their children.
export function pruneUnreadyLenses(scenes) {
  if (!scenes || typeof scenes !== "object") return scenes;
  let changed = false;
  const next = { ...scenes };
  for (const [id, scene] of Object.entries(scenes)) {
    if (!Array.isArray(scene?.perspectives)) continue;
    const seen = new Set();
    const keep = scene.perspectives.filter((e) => {
      const t = e && scenes[e.sceneId];
      const ok = t && isPerspectiveId(e.id) && !seen.has(e.id) && t.perspectiveOf === id && t.lens === e.id && isLensReady(t) && !isPerspectiveScene(scene);
      if (ok) seen.add(e.id);
      return ok;
    });
    if (keep.length !== scene.perspectives.length) {
      changed = true;
      next[id] = { ...scene, perspectives: keep };
    }
  }
  return changed ? next : scenes;
}

// Unique scene id for a new lens of baseId.
export function lensSceneId(scenes, baseId, lensId) {
  const stem = `${baseId}-${lensId}`.slice(0, 80).replace(/-+$/, "");
  let id = stem;
  let n = 2;
  while (scenes?.[id]) id = `${stem}-${n++}`;
  return id;
}

// ── prompt ────────────────────────────────────────────────────────────────────
// System prompt for writing ONE lens scene of a base scene. The JSON contract
// matches the child-scene writer, so normalizeGeneratedPack handles it.
export function buildPerspectivePrompt({ topicTitle = "", artStyle = "", base, lens, kind = "topic", focus = "", otherLenses = [] }) {
  const p = perspectiveById(lens);
  const baseSpots = (base?.hotspots || []).map((h) => h.label).filter(Boolean);
  return [
    `You are writing one page of a children's picture encyclopedia (ages 5–11) called Wikido${topicTitle ? `, in the world “${topicTitle}”` : ""}.`,
    `The page is “${base?.title}” seen through the ${p.name.toUpperCase()} perspective: ${p.description}`,
    base?.narration ? `What the main page already says: ${base.narration}` : "",
    `This is a ${kind}. ${p.spots}`,
    baseSpots.length ? `The main page already has these spots — do NOT repeat them; go deeper or show new things: ${baseSpots.join(", ")}.` : "",
    otherLenses.length ? `Other perspectives already exist (${otherLenses.join(", ")}); stay inside ${p.name}.` : "",
    focus ? `The curator asks to focus on: ${focus}.` : "",
    "Facts must be true and checkable; simple warm sentences a child can follow; respectful of every faith and people; never depict prophets.",
    "Write 6 to 8 spots. Each spot is ONE concrete thing that can be painted and pointed at.",
    `Art direction for the picture: ${p.art}${artStyle ? ` Keep the world's style: ${artStyle}.` : ""}`,
    "Return JSON only:",
    `{"scene":{"title":"${base?.title} — ${p.name}","narration":"2–3 sentences read aloud when the page opens","artPrompt":"one paragraph describing the whole picture, composition first","image":{"alt":"one sentence describing the picture"},"hotspots":[{"id":"kebab-id","label":"2–4 words","blurb":"one teaser line under 80 characters","visual":"what exactly is painted at this spot","x":10-90,"y":15-85,"info":{"title":"card title","body":["paragraph 1 (2–3 sentences)","paragraph 2 (optional)"],"fact":"one fun fact"}}]}}`,
    "Spread x/y so spots never overlap (at least 12 apart) and follow the composition you describe.",
  ].filter(Boolean).join("\n");
}

// Ids reachable from rootId along doorways and lens links.
export function reachableIds(scenes, rootId, packId = null) {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !scenes?.[id]) continue;
    seen.add(id);
    for (const c of sceneChildIds(scenes[id], packId)) stack.push(c);
  }
  return seen;
}

// A pack with every unready/broken lens unlisted, and the scenes that were
// reachable ONLY through those lenses removed. Anything that was already
// unreachable (loose scenes) is left alone, so strict checks still see it.
// Returns the same pack object when nothing changed.
export function dropUnreadyLenses(pack) {
  if (!pack?.scenes || !pack.rootSceneId) return pack;
  const scenes = pruneUnreadyLenses(pack.scenes);
  if (scenes === pack.scenes) return pack;
  const before = reachableIds(pack.scenes, pack.rootSceneId, pack.id);
  const after = reachableIds(scenes, pack.rootSceneId, pack.id);
  const next = { ...scenes };
  for (const id of before) if (!after.has(id)) delete next[id];
  return { ...pack, scenes: next };
}

// ── building a lens scene from the writer's answer ────────────────────────────
const clampPct = (n, lo, hi, d) => (Number.isFinite(+n) && n !== null && n !== "" ? Math.min(hi, Math.max(lo, +n)) : d);
const slug = (s) => String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// The writer's (or a previewed) scene -> a saveable lens scene, or { errors }.
// Keeps at most 8 complete spots, spreads missing coordinates, appends the
// lens's art guidance to the picture brief, and stamps the back-link.
export function buildLensScene(raw, { baseId, base, lensId, sceneId }) {
  const lens = perspectiveById(lensId);
  const errors = [];
  if (!lens || lensId === MAIN_LENS) return { errors: ["unknown perspective"] };
  const src = raw?.scene && typeof raw.scene === "object" ? raw.scene : raw;
  const title = String(src?.title || `${base?.title || baseId} — ${lens.name}`).trim().slice(0, 90);
  const narration = String(src?.narration || "").trim().slice(0, 900);
  if (!narration) errors.push("the perspective has no narration");
  const seen = new Set();
  const hotspots = [];
  for (const h of Array.isArray(src?.hotspots) ? src.hotspots : []) {
    if (hotspots.length >= 8) break;
    let id = slug(h?.id || h?.label);
    const label = String(h?.label || "").trim().slice(0, 60);
    const cardTitle = String(h?.info?.title || label).trim().slice(0, 90);
    const body = (Array.isArray(h?.info?.body) ? h.info.body : [h?.info?.body]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 4);
    if (!id || !label || !body.length) continue;
    const stem = id;
    let n = 2;
    while (seen.has(id)) id = `${stem}-${n++}`;
    seen.add(id);
    const k = hotspots.length;
    const visual = String(h?.visual || "").trim();
    const fact = String(h?.info?.fact || "").trim();
    hotspots.push({
      id,
      label,
      blurb: String(h?.blurb || cardTitle).trim().slice(0, 90),
      x: Math.round(clampPct(h?.x, 6, 94, 12 + ((k * 23) % 76))),
      y: Math.round(clampPct(h?.y, 10, 90, 25 + ((k * 17) % 55))),
      ...(visual ? { visual: visual.slice(0, 140) } : {}),
      info: { title: cardTitle, body, ...(fact ? { fact: fact.slice(0, 300) } : {}) },
    });
  }
  if (hotspots.length < 3) errors.push(`the perspective needs at least 3 spots (got ${hotspots.length})`);
  if (errors.length) return { errors };
  const brief = String(src?.artPrompt || "").trim().slice(0, 1200);
  const guidance = `Perspective: ${lens.name}. ${lens.art}`;
  return {
    errors: [],
    scene: {
      id: sceneId,
      title,
      narration,
      perspectiveOf: baseId,
      lens: lensId,
      artPrompt: brief.includes(guidance) ? brief : `${brief}${brief ? " " : ""}${guidance}`,
      image: { src: "", alt: String(src?.image?.alt || `${title}: ${lens.description}`).slice(0, 240) },
      hotspots,
    },
  };
}

// The base scene's lens list with lensId -> sceneId added (or replaced).
export function withLensEntry(base, lensId, sceneId) {
  const list = (Array.isArray(base?.perspectives) ? base.perspectives : []).filter((e) => e?.id !== lensId);
  return [...list.map((e) => ({ id: e.id, sceneId: e.sceneId })), { id: lensId, sceneId }];
}
