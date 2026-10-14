// Wikido studio pack helpers — the server-side twin of web/src/lib/wikido/schema.js.
// The web copy is canonical for the runtime; keep the two shape rules in sync.
// These are PURE functions so they unit-test without network or Admin SDK.

import { validateSceneHierarchy, isCrossTopicDoorway } from "./wikidoHierarchy.js";
import { isGlobeHub, validateSpotGeo, validateGlobeHubSpot } from "./wikidoGlobe.js";
import { isValidSpotLevel, slugName } from "./wikidoGazetteer.js";
export { validateDeclaredHierarchy } from "./wikidoHierarchy.js";

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "topic";
}

// Firestore-safe unique pack id from a title, e.g. "The Water Cycle" →
// "the-water-cycle" (or "the-water-cycle-2f3a" when that id is taken).
export function uniquePackId(title, takenIds = []) {
  const base = slugify(title);
  if (!takenIds.includes(base)) return base;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

export function countDiscoveries(pack) {
  if (!pack?.scenes) return 0;
  return Object.values(pack.scenes).reduce((n, s) => n + (Array.isArray(s.hotspots) ? s.hotspots.length : 0), 0);
}

function isPercent(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
}

function isSlug(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

// Structural validation for studio-saved / LLM-generated packs. Same shape
// rules as the web validator: ids, coords, image/narration presence, doorway
// references. `allowMissingArtwork` lets drafts save before their pictures are
// generated (publishing requires artwork, enforced by the caller). Returns an
// array of human-readable error strings.
export function validateTopicPack(pack, { allowMissingArtwork = false } = {}) {
  const errors = [];
  if (!pack || typeof pack !== "object") return ["pack must be an object"];
  if (!isSlug(pack.id)) errors.push(`id "${pack.id}" must be a kebab-case slug`);
  if (typeof pack.title !== "string" || !pack.title.trim()) errors.push("title is required");
  if (typeof pack.tagline !== "string" || !pack.tagline.trim()) errors.push("tagline is required");
  if (pack.view !== undefined && pack.view !== "globe") errors.push(`view must be "globe" when present`);
  if (!isSlug(pack.rootSceneId)) errors.push("rootSceneId must be a scene id");

  const scenes = pack.scenes;
  if (!scenes || typeof scenes !== "object" || Array.isArray(scenes) || Object.keys(scenes).length === 0) {
    errors.push("scenes must be a non-empty object keyed by scene id");
    return errors;
  }
  if (pack.rootSceneId && !scenes[pack.rootSceneId]) {
    errors.push(`rootSceneId "${pack.rootSceneId}" has no matching scene`);
  }

  for (const [sceneId, scene] of Object.entries(scenes)) {
    const path = `scenes.${sceneId}`;
    const hub = isGlobeHub(pack, sceneId); // the globe hub renders code, not artwork
    if (!isSlug(sceneId)) errors.push(`${path}: scene keys must be kebab-case slugs`);
    if (typeof scene.title !== "string" || !scene.title.trim()) errors.push(`${path}: title is required`);
    if (!hub) {
      if (!scene.image || typeof scene.image !== "object") errors.push(`${path}: image { src, alt } is required`);
      else {
        if (!allowMissingArtwork && (typeof scene.image.src !== "string" || !scene.image.src)) errors.push(`${path}: image.src is required`);
        if (typeof scene.image.alt !== "string" || !scene.image.alt) errors.push(`${path}: image.alt is required`);
      }
    }
    if (typeof scene.narration !== "string" || !scene.narration.trim()) errors.push(`${path}: narration is required`);
    if (!Array.isArray(scene.hotspots) || (scene.hotspots.length === 0 && !hub)) {
      errors.push(`${path}: hotspots must be a non-empty array`);
      continue;
    }
    const hotspotIds = new Set();
    for (const spot of scene.hotspots) {
      const spotId = spot?.id || "(missing id)";
      const spotPath = `${path}.hotspots[${spotId}]`;
      if (!isSlug(spot?.id)) errors.push(`${spotPath}: id must be a kebab-case slug`);
      if (hotspotIds.has(spot.id)) errors.push(`${spotPath}: duplicate hotspot id in scene`);
      hotspotIds.add(spot.id);
      if (typeof spot.label !== "string" || !spot.label.trim()) errors.push(`${spotPath}: label is required`);
      if (typeof spot.blurb !== "string" || !spot.blurb.trim()) errors.push(`${spotPath}: blurb is required`);
      if (!hub && (!isPercent(spot?.x) || !isPercent(spot?.y))) errors.push(`${spotPath}: x/y must be percentages between 0 and 100`);
      if (hub) errors.push(...validateGlobeHubSpot(spot, spotPath));
      else errors.push(...validateSpotGeo(spot, spotPath));
      const info = spot.info;
      if (!info || typeof info !== "object") { errors.push(`${spotPath}: info { title, body } is required`); continue; }
      if (typeof info.title !== "string" || !info.title.trim()) errors.push(`${spotPath}: info.title is required`);
      if (!Array.isArray(info.body) || !info.body.length || info.body.some((p) => typeof p !== "string" || !p.trim())) {
        errors.push(`${spotPath}: info.body must be a non-empty array of paragraphs`);
      }
      if (info.fact !== undefined && (typeof info.fact !== "string" || !info.fact.trim())) {
        errors.push(`${spotPath}: info.fact, when present, must be a non-empty string`);
      }
      if (spot.childTopicId !== undefined) {
        if (!isSlug(spot.childTopicId)) {
          errors.push(`${spotPath}: childTopicId must be a kebab-case slug`);
        } else if (spot.childTopicId === pack.id) {
          errors.push(`${spotPath}: childTopicId must name a DIFFERENT topic — doorways inside this topic just use childSceneId`);
        } else if (spot.childSceneId === undefined) {
          errors.push(`${spotPath}: childTopicId needs a childSceneId to open inside that topic`);
        }
      }
      if (spot.childSceneId !== undefined) {
        if (!isSlug(spot.childSceneId)) errors.push(`${spotPath}: childSceneId must be a scene slug`);
        else if (!isCrossTopicDoorway(spot, pack.id) && !scenes[spot.childSceneId]) {
          errors.push(`${spotPath}: childSceneId "${spot.childSceneId}" has no matching scene`);
        }
      }
    }
  }
  errors.push(...validateSceneHierarchy(scenes, pack.rootSceneId, pack.id));
  return errors;
}

// Best-effort repair of an LLM-generated pack before validation: coerce ids to
// slugs, dedupe hotspot ids, drop hotspots with no real content, and default
// missing cosmetic fields. Returns { pack, fixes: string[] }.
export function normalizeGeneratedPack(raw) {
  const fixes = [];
  const pack = structuredClone(raw);

  pack.id = slugify(pack.id || pack.title);
  for (const key of ["title", "tagline", "emoji", "artStyle", "rootSceneId"]) {
    if (typeof pack[key] !== "string") pack[key] = undefined;
  }
  if (!pack.emoji) { pack.emoji = "🌟"; fixes.push("defaulted emoji"); }

  if (Array.isArray(pack.scenes)) {
    // LLMs sometimes emit an array — key it by id.
    pack.scenes = Object.fromEntries(pack.scenes.map((s) => [s?.id || s?.title, s]));
    fixes.push("converted scenes array to map");
  }
  const scenesIn = pack.scenes && typeof pack.scenes === "object" && !Array.isArray(pack.scenes) ? pack.scenes : {};
    const scenes = {};
    for (const [key, scene] of Object.entries(scenesIn)) {
      const id = slugify(scene?.id || key);
      const out = { id, title: String(scene?.title || "").trim(), narration: String(scene?.narration || "").trim() };
      if (id !== key) fixes.push(`scene "${key}" → "${id}"`);
      out.image = {
        // artwork is generated separately; src may be empty until then
        src: typeof scene?.image?.src === "string" ? scene.image.src : "",
        alt: String(scene?.image?.alt || out.title || "").slice(0, 240),
      };
      if (typeof scene?.artPrompt === "string") out.artPrompt = scene.artPrompt.trim();
      // recorded voiceovers (studio audio) must survive normalization
      if (typeof scene?.audio === "string" && scene.audio) out.audio = scene.audio;

      const hotspotsIn = Array.isArray(scene?.hotspots) ? scene.hotspots : [];
      const seenIds = new Set();
      out.hotspots = [];
      for (const spot of hotspotsIn) {
        const sid = slugify(spot?.id || spot?.label);
        if (!sid || seenIds.has(sid)) { fixes.push(`dropped hotspot with duplicate/empty id in "${id}"`); continue; }
        const title = String(spot?.info?.title || spot?.label || "").trim();
        const body = (Array.isArray(spot?.info?.body) ? spot.info.body : [spot?.info?.body])
          .map((p) => String(p || "").trim()).filter(Boolean);
        if (!title || !body.length || !String(spot?.label || "").trim()) {
          fixes.push(`dropped incomplete hotspot "${sid}" in "${id}"`);
          continue;
        }
        seenIds.add(sid);
        out.hotspots.push({
          id: sid,
          label: String(spot.label).trim(),
          blurb: String(spot.blurb || spot.info?.title || "").trim(),
          x: Number.isFinite(+spot?.x) ? Math.min(100, Math.max(0, +spot.x)) : 50,
          y: Number.isFinite(+spot?.y) ? Math.min(100, Math.max(0, +spot.y)) : 50,
          info: {
            title,
            body,
            ...(spot?.info?.fact ? { fact: String(spot.info.fact).trim() } : {}),
          },
          // globe placement survives normalization: lat/lng on the planet, the
          // zoom level the spot appears at, and the country it belongs to
          ...(Number.isFinite(+spot?.lat) ? { lat: Math.min(90, Math.max(-90, Math.round(+spot.lat * 10000) / 10000)) } : {}),
          ...(Number.isFinite(+spot?.lng) ? { lng: Math.min(180, Math.max(-180, Math.round(+spot.lng * 10000) / 10000)) } : {}),
          ...(isValidSpotLevel(spot?.level) ? { level: spot.level } : {}),
          ...(isSlug(spot?.countryId) ? { countryId: spot.countryId } : {}),
          ...(spot?.childSceneId ? { childSceneId: slugify(spot.childSceneId) } : {}),
          // cross-topic doorways keep the world they point at
          ...(typeof spot?.childTopicId === "string" && spot.childTopicId ? { childTopicId: slugify(spot.childTopicId) } : {}),
          // recorded voiceover references survive normalization too
          ...(typeof spot?.audio === "string" && spot.audio ? { audio: spot.audio } : {}),
        });
      }
      scenes[id] = out;
    }
  pack.scenes = scenes;

  // Root: prefer the declared root if valid, else the first scene.
  if (!pack.rootSceneId || !scenes[pack.rootSceneId]) {
    const first = Object.keys(scenes)[0];
    if (first) { pack.rootSceneId = first; fixes.push(`rootSceneId → "${first}"`); }
  }
  // Doorways pointing at scenes that no longer exist are stripped at validation;
  // leave them for validateTopicPack to report.
  return { pack, fixes };
}

// Studio saves: normalize the incoming pack (repairs missing/duplicate ids from
// labels, keeps recorded-audio references), inject the canonical document id,
// then validate as a draft (artwork may still be pending). Returns
// { pack, fixes, errors } — errors non-empty means unsaveable.
export function normalizeForSave(pack, topicId) {
  const { pack: normalized, fixes } = normalizeGeneratedPack({ ...pack, id: topicId });
  normalized.id = topicId;
  const errors = validateTopicPack(normalized, { allowMissingArtwork: true });
  return { pack: normalized, fixes, errors };
}

// ── LLM output parsing ────────────────────────────────────────────────────────

// Strip markdown fences / chatter and parse the model's JSON answer.
export function parseLlmJson(text) {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── LLM prompts ───────────────────────────────────────────────────────────────

// Appended LAST to every Wikido image prompt — the bundled-worlds script and
// the studio runtime alike — so it outranks any pack-level style text: a
// Wikido picture is an encyclopedia plate, true to life, never abstract.
export const WIKIDO_REALISM_DIRECTIVE =
  "REALISM, HIGHEST PRIORITY: this picture is a plate from a children's encyclopedia — " +
  "show the subject exactly as it looks in real life, like a sharp nature-documentary frame: " +
  "true-to-life anatomy, proportions, scale, colors, materials and lighting, real textures, faithful detail. " +
  "Do NOT abstractify or stylize: no cartoon shapes, no flat vector look, no exaggerated or fantasy forms, " +
  "no surreal distortion, no smudged painterly washes. " +
  "The composition stays clear and easy for a child to read, but every object remains recognizably real.";

// The spot-awareness section of a scene-art prompt: the painter is told which
// objects the scene's spots describe (so they are actually painted) and must
// return, as JSON text next to the picture, the exact percentages where each
// landed — those coordinates move the pins. Live-verified phrasing: the image
// model reliably emits the JSON when told to output it FIRST and paint SECOND
// (a "report after painting" ask comes back with the picture alone). Empty
// when the scene has no spots.
export function buildSpotArtDirection(spots = []) {
  const list = (spots || []).filter((h) => h && String(h.label || "").trim());
  if (!list.length) return "";
  const items = list
    .map((h) => {
      const what = String(h.blurb || h.info?.title || "").trim();
      const pin =
        Number.isFinite(+h.x) && Number.isFinite(+h.y)
          ? ` The spot's pin currently sits at about ${Math.round(+h.x)}%, ${Math.round(+h.y)}% (across, down) — paint it near that area when the composition allows.`
          : "";
      return `- "${h.label}" (id: ${h.id || "unknown"})${what ? ` — ${what}.` : "."}${pin}`;
    })
    .join("\n");
  return (
    "SPOTS ON THIS PICTURE — you will do TWO things in order. FIRST, output ONE line of JSON text and nothing else in it: " +
    'the exact place you painted each spot, one entry per spot id listed below — ' +
    '{"placements": [{"id": "<spot id>", "x": <percent across, 0-100, one decimal>, "y": <percent down, 0-100, one decimal>}]} ' +
    "(x=0 is the left edge, x=100 the right edge, y=0 the top, y=100 the bottom). THEN paint the picture. " +
    "Every spot below names a real object or area that MUST be clearly visible and recognizable in it — a spot that points at nothing is broken:\n" +
    items
  );
}

// Single composer for every scene-art prompt: pack style, scene composition,
// spot awareness, parent coherence, then the realism directive last so it
// always wins.
export function composeSceneArtPrompt({ artStyle = "", artPrompt = "", coherence = "", spots = [] } = {}) {
  return [artStyle, artPrompt, buildSpotArtDirection(spots), coherence, WIKIDO_REALISM_DIRECTIVE]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

const EXEMPLAR = `{
  "id": "the-water-cycle",
  "title": "The Water Cycle",
  "emoji": "💧",
  "tagline": "How a drop of water travels the whole world",
  "artStyle": "True-to-life, highly detailed naturalistic illustration like a modern children's encyclopedia plate: accurate anatomy, proportions, colors, materials and lighting, real-world textures, soft natural light; every subject looks the way it really looks. No stylization, no abstraction, no cartoon shapes, no text. Wide 16:9 composition.",
  "rootSceneId": "water-cycle-overview",
  "hierarchy": {
    "sceneId": "water-cycle-overview",
    "children": [ { "sceneId": "glacier-closeup", "hotspotId": "glacier", "children": [] } ]
  },
  "scenes": {
    "water-cycle-overview": {
      "id": "water-cycle-overview",
      "title": "The Water Cycle",
      "artPrompt": "Sweeping establishing view of a valley showing the whole water cycle at golden hour. COMPOSITION (left to right): a bright sun over the SEA on the LEFT with mist rising; green HILLS in the CENTRE with a small lake; tall MOUNTAINS on the RIGHT with white clouds gathering around the peaks and rain falling on the far slope; a river runs from the mountains back to the sea across the foreground.",
      "image": { "src": "", "alt": "A valley showing sea, mist, hills, a lake, mountains and rain" },
      "narration": "Follow one drop of water around the biggest journey on Earth...",
      "hotspots": [
        {
          "id": "evaporation",
          "label": "Evaporation",
          "blurb": "The sun lifts the sea into the sky",
          "x": 14, "y": 30,
          "info": {
            "title": "Evaporation",
            "body": ["The sun heats the sea...", "Tiny drops too small to see float upward..."],
            "fact": "About 900 million million tonnes of water evaporate from the oceans every year!"
          }
        },
        {
          "id": "glacier",
          "label": "Glaciers & Snow",
          "blurb": "Frozen water storage — step inside",
          "x": 88, "y": 28,
          "childSceneId": "glacier-closeup",
          "info": { "title": "Glaciers & Snow", "body": ["High on the mountains..."], "fact": "Glaciers hold about 69% of all the fresh water on Earth." }
        }
      ]
    },
    "glacier-closeup": {
      "id": "glacier-closeup",
      "title": "Inside a Glacier",
      "artPrompt": "Close-up inside a blue glacier cave...",
      "image": { "src": "", "alt": "A blue glacier cave with sunlight shining through the ice" },
      "narration": "Deep inside the ice...",
      "hotspots": [
        { "id": "ice-layers", "label": "Layers of Snow", "blurb": "A diary written in ice", "x": 40, "y": 50, "info": { "title": "Layers of Snow", "body": ["Snow falls every winter..."], "fact": "Scientists reading ice layers can learn what the weather was like 800,000 years ago." } }
      ]
    }
  }
}`;

// Build the generation prompt for a WHOLE topic. `existingIds` lets the model
// avoid duplicating scenes the topic already has (used when growing a topic).
export function buildTopicPrompt({ title, angle = "", levels = 3 }) {
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for curious children aged 7-11. Design a hand-crafted topic pack about "${title}"${angle ? `, with this special focus: ${angle}` : ""}.

A pack is a tree of full-screen PICTURE SCENES. The first scene shows the whole subject at once; its hotspots are aspects of it; some hotspots are DOORWAYS that step into a deeper scene (a close-up of that one thing). Aim for about ${levels} levels of depth and 8-12 scenes total, with 3-5 hotspots per scene. Every hotspot without a doorway is still worth tapping: give it a genuinely interesting, factually correct explanation and one delightful fun fact.

STRICT RULES
1. Output ONLY a JSON object — no markdown fences, no commentary.
2. The JSON shape must exactly match this exemplar (same fields, same nesting):
${EXEMPLAR}
3. Scene "artPrompt": describe the picture's COMPOSITION explicitly (what sits left / centre / right / foreground), because hotspots are pinned to percentages of this exact picture — the landmark a hotspot names must be drawable at that spot. No words or letters in the picture.
4. Hotspot x/y: sensible percentages over your own artPrompt composition, where that landmark actually appears.
5. Language: warm, concrete, exciting for a 8-year-old. Short paragraphs (2 per info card). Every info card gets one surprising but TRUE "fact".
6. childSceneId must reference a scene id that exists in your "scenes" object. Scene ids and hotspot ids: kebab-case slugs. Never emit "childTopicId" — new topics stand alone; doors into other worlds are added later by curators.
7. The topic must work standalone: the first scene introduces the subject; the deepest scenes are close-ups or inner workings.
8. Accuracy matters — no myths, no made-up numbers.
9. Include a top-level "hierarchy" object alongside "scenes": { "sceneId": "water-cycle-overview", "children": [ { "sceneId": "glacier-closeup", "hotspotId": "glacier", "children": [] } ] }. Every node has children (empty for leaves); every non-root node names the hotspotId ON ITS PARENT that opens it. List every scene exactly once, in doorway order. The hierarchy and childSceneId links must agree exactly. No cycles, disconnected scenes, shared children, or links back to the root.
10. Plan the subject hierarchy BEFORE writing scene content. Each child must be a subtopic of its immediate parent, never a cousin from another branch. For Living Things: plant kinds belong under Plants, animal kinds under Animals, and bodies, brains, culture under Human Beings. Match each doorway's label, explanation and art landmark to its child. Fact-card spots are not scenes: only include them in the hierarchy if you actually generate a child scene for them.
11. Recheck the entire hierarchy against scene titles, narration, hotspots and artwork prompts before returning JSON.
12. Realism: the pictures are encyclopedia plates, so "artStyle" must ask for true-to-life, naturalistic rendering and every "artPrompt" must describe things as they really look — never request abstract, stylized, cartoonish or fantasy rendering.`;
}

export function buildHierarchyReviewPrompt() {
  return `Review a generated children's picture-encyclopedia pack independently. Check EVERY parent/child relation in hierarchy against scene titles, narration, artwork prompts and the parent hotspot's label and explanation. Children must be genuine subtopics of their immediate parent; cousins must stay in their own branches. For Living Things, plant kinds belong under Plants, animal kinds under Animals, bodies and brains under Human Beings. Fact-card hotspots need not have child scenes. Reject misplaced branches, contradictory doorway content, or irrelevant scenes. Return ONLY JSON: { "valid": true, "issues": [] } or { "valid": false, "issues": ["specific parent, child and correction needed"] }. Do not approve unless every relation makes sense.`;
}

// Prompt for ONE deeper scene under an existing parent.
export function buildChildScenePrompt({ parentScene, siblingTitles, label, focus }) {
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. We are growing an existing topic one level deeper.

The parent scene is "${parentScene.title}". Its narration: "${parentScene.narration}"
Its current hotspots: ${parentScene.hotspots.map((h) => h.label).join(", ")}.
Existing deeper scenes (do not repeat them): ${siblingTitles.length ? siblingTitles.join(", ") : "none"}.

Design ONE new deeper scene${label ? ` that opens from the hotspot "${label}"` : ""}${focus ? `, focused on: ${focus}` : ""}. It must zoom INTO one concrete thing (a place, machine, creature, process or idea) and reveal how it works, with 3-5 hotspots of its own. Those hotspots are leaves (no childSceneId) unless you are certain a further scene is warranted — prefer leaves.

STRICT RULES
1. Output ONLY a JSON object with exactly these fields:
{
  "scene": { "id": "kebab-case-id", "title": "...", "artPrompt": "composition description...", "image": { "src": "", "alt": "..." }, "narration": "2-4 sentences read aloud to the child", "hotspots": [ { "id": "...", "label": "...", "blurb": "5-8 word teaser", "x": 50, "y": 50, "info": { "title": "...", "body": ["...", "..."], "fact": "..." } } ] },
  "hotspot": { "label": "short doorway label for the parent scene", "blurb": "5-8 word teaser", "x": 50, "y": 50 }
}
2. The hotspot x/y you return is where the doorway sits ON THE PARENT SCENE'S picture — pick an open spot away from the parent's other hotspots (${parentScene.hotspots.map((h) => `${h.label} ${h.x},${h.y}`).join("; ")}).
3. The scene artPrompt must describe the picture composition explicitly (left/centre/right/foreground) so hotspots land on real landmarks, and must describe things as they really look — the picture stays true to life, never abstract or stylized. No text in the picture.
4. Warm, concrete, age 7-11. Factually correct. One delightful true fact per hotspot.
5. Output JSON only — no markdown fences, no commentary.`;
}

// ── Suggest deeper scenes (read-only; nothing is written) ─────────────────────

// Prompt asking for a handful of candidate deeper scenes under a parent. The
// answer is only ever shown to the curator as chips — the curator's click runs
// the normal addWikidoChildScene path.
export function buildSuggestPrompt({ topicTitle, parentScene, existingTitles = [], count = 4 }) {
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. The topic is "${topicTitle}".

The scene "${parentScene.title}" ("${parentScene.narration}") has these spots: ${(parentScene.hotspots || []).map((h) => h.label).join(", ") || "none"}.
Scenes that already exist in this topic (never suggest these or near-duplicates): ${existingTitles.length ? existingTitles.join(", ") : "none"}.

Suggest ${count} different deeper scenes a child could open from "${parentScene.title}". Each must zoom INTO one concrete, drawable thing (a place, machine, creature, process or idea), be clearly different from the others, and build on what the parent shows. Order them from the most natural next step to the most adventurous.

Output ONLY this JSON, no fences or commentary:
{ "suggestions": [ { "label": "short scene name, max 5 words", "focus": "one sentence on what it teaches", "why": "one short sentence on why a child would want to open it" } ] }`;
}

// Defensive clean-up of the model's suggestions: strings only, trimmed and
// length-capped, duplicates of each other or of existing scenes removed.
export function normalizeSuggestions(raw, existingTitles = [], max = 5) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(existingTitles.map(norm));
  const out = [];
  for (const item of Array.isArray(raw?.suggestions) ? raw.suggestions : []) {
    const label = String(item?.label || "").trim().slice(0, 60);
    const focus = String(item?.focus || "").trim().slice(0, 300);
    if (!label || !focus || taken.has(norm(label))) continue;
    taken.add(norm(label));
    out.push({ label, focus, why: String(item?.why || "").trim().slice(0, 160) });
    if (out.length >= max) break;
  }
  return out;
}

// ── Outline planning (read-only draft of a whole branch) ──────────────────────

export const OUTLINE_LIMITS = { maxDepth: 3, maxChildren: 4, maxTotal: 12 };

export function buildOutlinePrompt({ topicTitle, parentScene, existingTitles = [], total = 6, depth = 2 }) {
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. The topic is "${topicTitle}".

Plan a BRANCH of new deeper scenes under the scene "${parentScene.title}" ("${parentScene.narration}"), which already has the spots: ${(parentScene.hotspots || []).map((h) => h.label).join(", ") || "none"}.
Scenes that already exist (never repeat or near-duplicate them): ${existingTitles.length ? existingTitles.join(", ") : "none"}.

Plan about ${total} new scenes in total, at most ${depth} levels deep and at most ${OUTLINE_LIMITS.maxChildren} children under any scene. Each scene must zoom INTO one concrete, drawable thing, and its artPrompt must visually CONTINUE the parent picture (same world, style, palette, lighting — a zoom-in, not a new world). Order siblings by learning flow (what a child should meet first comes first); a child scene must build on its parent.

Output ONLY this JSON, no fences or commentary:
{ "outline": [ { "label": "short scene name, max 5 words", "focus": "one sentence on what it teaches", "children": [ same shape, optional ] } ] }`;
}

// Defensive clean-up of a model outline: shape, lengths, depth/breadth/total
// caps (breadth-first so the most important scenes survive a trim), and
// duplicates removed. Returns { outline, trimmed } — `trimmed` is true when
// anything was dropped for a cap or as a duplicate.
export function normalizeOutline(raw, existingTitles = [], limits = OUTLINE_LIMITS) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(existingTitles.map(norm));
  let count = 0;
  let trimmed = false;

  const clone = (n) => ({
    label: String(n?.label || "").trim().slice(0, 60),
    focus: String(n?.focus || "").trim().slice(0, 300),
    children: [],
  });

  const roots = [];
  const queue = []; // { src, dst, depth } — breadth-first
  const accept = (src, depth, into) => {
    const node = clone(src);
    if (!node.label || !node.focus) { trimmed = true; return null; }
    if (taken.has(norm(node.label))) { trimmed = true; return null; }
    if (count >= limits.maxTotal) { trimmed = true; return null; }
    taken.add(norm(node.label));
    count += 1;
    into.push(node);
    queue.push({ src, dst: node, depth });
    return node;
  };

  const top = Array.isArray(raw?.outline) ? raw.outline : [];
  top.slice(0, limits.maxChildren).forEach((s) => accept(s, 1, roots));
  if (top.length > limits.maxChildren) trimmed = true;

  while (queue.length) {
    const { src, dst, depth } = queue.shift();
    const kids = Array.isArray(src?.children) ? src.children : [];
    if (!kids.length) continue;
    if (depth >= limits.maxDepth) { trimmed = true; continue; }
    kids.slice(0, limits.maxChildren).forEach((k) => accept(k, depth + 1, dst.children));
    if (kids.length > limits.maxChildren) trimmed = true;
  }
  return { outline: roots, trimmed };
}

// ── Spot details by agent ─────────────────────────────────────────────────────
// Writes the card a child sees when they tap ONE spot: label, hover teaser,
// card title, 1–2 short paragraphs, and a fun fact. Pure helpers — tested.

export function buildSpotDetailsPrompt({ topicTitle, artStyle = "", scene, spot, siblingLabels = [], childSceneTitle = "", hint = "" }) {
  const kind = spot?.childTopicId
    ? `This spot is a CROSS-TOPIC DOORWAY: it opens the scene "${childSceneTitle || spot.childSceneId}" inside ANOTHER Wikido world ("${spot.childTopicId}"). Write a teaser that makes the child want to step into that other world, and a card that fits that destination.`
    : spot?.childSceneId
    ? `This spot is a DOORWAY: tapping it takes the child to the scene "${childSceneTitle || spot.childSceneId}". Write a teaser that makes them want to step through, and a card that fits that destination.`
    : `This spot is a FACT CARD: tapping it shows the card you write now.`;
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for curious children aged 7-11.

Topic: "${topicTitle}".
The scene: "${scene?.title}". Scene narration: "${scene?.narration || ""}".
The picture: ${scene?.artPrompt || scene?.image?.alt || "scene artwork"}.
Other spots on this picture (avoid repeating them): ${siblingLabels.length ? siblingLabels.join(", ") : "none"}.
${kind}
The spot sits at ${Math.round(spot?.x ?? 50)}%, ${Math.round(spot?.y ?? 50)}% of the picture (across, down).
${hint ? `Extra direction from the curator: ${hint}` : ""}

Write the spot's details as JSON:
{
  "label": "1-3 word spot name shown on the picture (e.g. \\"The Moon\\")",
  "blurb": "short hover teaser, 4-8 words",
  "info": {
    "title": "card title",
    "body": ["one short child-friendly paragraph", "a second short paragraph if it helps"],
    "fact": "one surprising but TRUE fun fact"
  }
}

STRICT RULES
1. Output ONLY the JSON object — no markdown fences, no commentary.
2. Warm, concrete, exciting for an 8-year-old. Factually correct — no invented numbers or myths.
3. The label must match something actually visible at that spot in the picture described above.
4. body: 1-2 short paragraphs (each 1-2 sentences).`;
}

// Coerce the model's answer into safe spot fields. Returns
// { spot: { label, blurb, info }, errors } — errors non-empty means unusable.
export function normalizeSpotDetails(parsed) {
  const p = parsed || {};
  const label = String(p.label || "").trim();
  const blurb = String(p.blurb || p.info?.title || "").trim();
  const title = String(p.info?.title || p.label || "").trim();
  const body = (Array.isArray(p.info?.body) ? p.info.body : [p.info?.body])
    .map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3);
  const fact = String(p.info?.fact || "").trim();
  const errors = [];
  if (!label) errors.push("missing label");
  if (!title) errors.push("missing card title");
  if (!body.length) errors.push("missing card text");
  return { spot: { label, blurb, info: { title, body, ...(fact ? { fact } : {}) } }, errors };
}

// ── Topic-wide depth assessment ───────────────────────────────────────────────
// The "Add more depth" agent: reads the WHOLE topic (scenes, spots, doorways)
// and proposes the most valuable new deeper scenes, wherever they belong.

export function buildDepthPrompt({ pack, maxScenes = 3, hint = "" }) {
  const lines = [];
  for (const s of Object.values(pack.scenes || {})) {
    const spots = s.hotspots || [];
    const doors = spots
      .filter((h) => h.childSceneId)
      .map((h) => `${h.label} → "${pack.scenes[h.childSceneId]?.title || "?"}"`);
    const facts = spots.filter((h) => !h.childSceneId).map((h) => h.label);
    lines.push(
      `- "${s.title}" (parentSceneId: ${s.id}) — ${(s.narration || "").slice(0, 140)}` +
        (doors.length ? ` · opens: ${doors.join("; ")}` : "") +
        ` · fact spots: ${facts.length ? facts.join(", ") : "none"}`
    );
  }
  // optional curator steering — capped so one long answer can't blow the prompt
  const direction = String(hint || "").trim().slice(0, 300);
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. The topic is "${pack.title}".

Here is the ENTIRE topic — every scene, what it teaches, and where its doorways lead:
${lines.join("\n")}
${direction ? `\nTHE CURATOR'S DIRECTION (highest priority — the new scenes must follow it wherever it fits this topic):\n"${direction}"\n` : ""}
Assess it like a curator: which branches are too thin, which spots beg to be explored further, which big idea is missing? Then propose up to ${maxScenes} NEW deeper scenes at the most valuable places${direction ? ", following the curator's direction" : ""}.

RULES
1. Each new scene zooms INTO one concrete, drawable thing and teaches something NOT already covered by the scenes above.
2. parentSceneId MUST be an existing scene id from the list — the new scene's doorway appears on that scene's picture, and the doorway label must fit what that picture shows.
3. Prefer scenes with few or no child scenes yet; never duplicate an existing branch.
4. A child entry may chain one level deeper when it truly helps; standalone deeper scenes are usually right.
5. Output ONLY this JSON, no fences or commentary:
{ "additions": [ { "parentSceneId": "existing-scene-id", "label": "short doorway label, max 5 words", "focus": "one sentence on what the new scene teaches", "children": [ { "label": "...", "focus": "..." } ] } ] }`;
}

// Validate + cap the model's additions against the CURRENT topic: parents must
// exist, branches dedupe against existing scene titles, budget spread across
// branches. Returns { branches: [{ parentSceneId, outline }], skipped }.
export function normalizeDepthPlan(raw, pack, maxScenes = 3) {
  const additions = Array.isArray(raw?.additions) ? raw.additions : [];
  const existingTitles = Object.values(pack.scenes || {}).map((s) => s.title);
  const branches = [];
  let budget = maxScenes;
  const seenParents = new Set();
  let skipped = 0;
  for (const a of additions) {
    if (budget <= 0) break;
    const parentSceneId = slugify(a?.parentSceneId || "");
    if (!parentSceneId || !pack.scenes?.[parentSceneId] || seenParents.has(parentSceneId)) { skipped += 1; continue; }
    seenParents.add(parentSceneId);
    const branch = normalizeOutline(
      { outline: [{ label: a?.label, focus: a?.focus, children: Array.isArray(a?.children) ? a.children : [] }] },
      existingTitles,
      { ...OUTLINE_LIMITS, maxTotal: budget, maxChildren: 2, maxDepth: 2 }
    );
    if (!branch.outline.length) { skipped += 1; continue; }
    budget -= branch.outline.reduce((n, node) => n + 1 + (node.children?.length || 0), 0);
    branches.push({ parentSceneId, outline: branch.outline });
  }
  return { branches, skipped };
}

// ── Re-link misplaced scenes (agent assessment) ────────────────────────────────
// The studio's "✦ Re-link misplaced scenes" agent: reads the WHOLE topic and
// proposes, for every scene that is unreachable from the entrance (a save
// blocker) or hangs under an unrelated parent, the proper parent scene.
// Read-only — the studio applies the moves through the same guarded tree
// helpers its map's drag-and-drop uses, so nothing changes until a save.

export function buildRelinkPrompt({ pack }) {
  // reachability from the entrance along local doorways — mirrors the save check
  const reachable = new Set();
  const walk = (id) => {
    if (reachable.has(id) || !pack.scenes?.[id]) return;
    reachable.add(id);
    for (const h of pack.scenes[id].hotspots || []) if (h.childSceneId && !h.childTopicId) walk(h.childSceneId);
  };
  walk(pack.rootSceneId);

  const lines = Object.values(pack.scenes || {}).map((s) => {
    const spots = s.hotspots || [];
    const doors = spots
      .filter((h) => h.childSceneId && !h.childTopicId)
      .map((h) => `${h.label} → "${pack.scenes[h.childSceneId]?.title || "?"}"`);
    const facts = spots.filter((h) => !h.childSceneId).map((h) => h.label);
    const parent = Object.values(pack.scenes).find((p) => (p.hotspots || []).some((h) => h.childSceneId === s.id && !h.childTopicId));
    const status = s.id === pack.rootSceneId
      ? "THE ENTRANCE (never moves)"
      : reachable.has(s.id)
        ? `opens from "${parent?.title || "?"}"`
        : "UNREACHABLE — no doorway opens it, a child can never see it";
    return (
      `- "${s.title}" (sceneId: ${s.id}) — ${status} · ${(s.narration || "").slice(0, 140)}` +
      (doors.length ? ` · opens: ${doors.join("; ")}` : "") +
      ` · fact spots: ${facts.length ? facts.join(", ") : "none"}`
    );
  });

  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. The topic is "${pack.title}", entered at "${pack.scenes?.[pack.rootSceneId]?.title || pack.rootSceneId}" (rootSceneId: ${pack.rootSceneId}).

Here is the ENTIRE topic — every scene, where it hangs, what it teaches, and where its doorways lead:
${lines.join("\n")}

Some scenes may be UNREACHABLE (nothing opens them) or hang under a parent they don't belong to. Using each scene's title, narration and spot labels, judge which subtopic each scene really belongs to, then propose the smallest set of moves that links every misplaced scene under its proper parent.

RULES
1. Every UNREACHABLE scene MUST get a move — the topic must be fully walkable from the entrance.
2. Only move scenes that are unreachable or clearly misplaced; leave well-placed scenes alone.
3. parentSceneId MUST be an existing scene id — never the scene itself, never one of its own subtopics, never the entrance.
4. The doorwayLabel must fit what the parent's picture shows and name what the child will find (max 5 words).
5. Prefer the closest subject: a scene about the heart belongs under the scene whose picture shows the heart, not under the whole topic.
6. Output ONLY this JSON, no fences or commentary — when nothing needs moving, output { "moves": [] }:
{ "moves": [ { "sceneId": "existing-scene-id", "parentSceneId": "existing-scene-id", "doorwayLabel": "max 5 words", "reason": "one short sentence" } ] }`;
}

// Validate the model's moves against the CURRENT topic: both scenes must exist,
// the moved scene can't be the entrance, land in its own subtree, or already
// hang under the target, the target picture must have room for the new doorway
// (8 spots), and one scene moves once. Returns
// { moves: [{ sceneId, parentSceneId, doorwayLabel, reason }], skipped }.
export function normalizeRelinkPlan(raw, pack) {
  const scenes = pack.scenes || {};
  const subtreeOf = (id) => {
    const out = new Set();
    const walk = (x) => {
      if (out.has(x) || !scenes[x]) return;
      out.add(x);
      for (const h of scenes[x].hotspots || []) if (h.childSceneId && !h.childTopicId) walk(h.childSceneId);
    };
    walk(id);
    return out;
  };
  const parentIdOf = (sceneId) => {
    for (const s of Object.values(scenes)) {
      if ((s.hotspots || []).some((h) => h.childSceneId === sceneId && !h.childTopicId)) return s.id;
    }
    return null;
  };

  const moves = [];
  const perParent = new Map();
  const seenScenes = new Set();
  let skipped = 0;
  for (const m of Array.isArray(raw?.moves) ? raw.moves : []) {
    if (moves.length >= 8) break;
    const sceneId = slugify(m?.sceneId || "");
    const parentSceneId = slugify(m?.parentSceneId || "");
    if (!scenes[sceneId] || !scenes[parentSceneId]) { skipped += 1; continue; }        // unknown scene or parent
    if (sceneId === pack.rootSceneId || sceneId === parentSceneId) { skipped += 1; continue; } // entrance / self
    if (seenScenes.has(sceneId)) { skipped += 1; continue; }                           // one move per scene
    if (subtreeOf(sceneId).has(parentSceneId)) { skipped += 1; continue; }             // would disconnect its own branch
    if (parentIdOf(sceneId) === parentSceneId) { skipped += 1; continue; }             // already there
    const incoming = perParent.get(parentSceneId) || 0;
    if ((scenes[parentSceneId].hotspots || []).length + incoming >= 8) { skipped += 1; continue; } // picture full
    perParent.set(parentSceneId, incoming + 1);
    seenScenes.add(sceneId);
    moves.push({
      sceneId,
      parentSceneId,
      doorwayLabel: String(m?.doorwayLabel || "").trim().slice(0, 60),
      reason: String(m?.reason || "").trim().slice(0, 200),
    });
  }
  return { moves, skipped };
}

// ── Visual coherence across depth ─────────────────────────────────────────────
// The scene whose doorway opens this one (null for roots and orphans).
export function parentSceneOf(scenes, sceneId) {
  for (const s of Object.values(scenes || {})) {
    if ((s.hotspots || []).some((h) => h.childSceneId === sceneId)) return s;
  }
  return null;
}

// Coherence instruction prepended to a child scene's artwork generation: the
// reference (parent picture) anchors style, palette, lighting and textures so
// deeper layers read as the same world. Style continuity never overrides
// realism — both pictures stay true to life.
export function coherencePrompt(referenceTitle) {
  return (
    `The reference image is the parent scene of this picture-book page. Create the NEXT page: ` +
    `keep the EXACT same illustration style, color palette, lighting mood, texture quality ` +
    `and level of detail, so the two pictures read as one continuous world` +
    (referenceTitle ? ` — this page zooms deeper from "${referenceTitle}"` : "") +
    `. Matching the parent must never drift away from reality: both pictures stay true to life, like encyclopedia plates.`
  );
}

// ── Agent-placed spot coordinates ─────────────────────────────────────────────
// After artwork is generated, a vision call reads the finished picture and
// returns where each spot belongs, in percentages of that exact picture.

export function buildSpotPlacementPrompt({ scene }) {
  const spots = (scene.hotspots || [])
    .map((h) => ({ id: h.id, label: h.label, blurb: h.blurb, info: h.info }));
  return `You are a precise art director for a children's picture-encyclopedia.

Below is the FINISHED illustration for the scene "${scene.title}". For each spot listed, decide the very best (x, y) position — in percentages of the picture, where x=0 is the left edge, x=100 the right edge, y=0 the top, y=100 the bottom — so the spot's dot sits exactly on the object or area it describes. Use what is actually visible in the picture.

Spots to place:
${JSON.stringify(spots, null, 2)}

Rules:
1. Positions must match what is really drawn in THIS picture (a label about a giraffe goes on the giraffe).
2. Keep spots inside 5–95 on both axes, away from the exact edges.
3. Two spots must not overlap.
4. Output ONLY this JSON, no fences or commentary:
{ "placements": [ { "id": "spot-id", "x": 42, "y": 30 } ] }`;
}

// Apply normalized placements to a scene's hotspots → a NEW hotspots array in
// which every placed spot carries its new coordinates. Spots the model couldn't
// place keep their current coordinates.
export function applySpotPlacements(hotspots, placements) {
  return (hotspots || []).map((h) => {
    const placed = (placements || []).find((p) => p.id === h.id);
    return placed ? { ...h, x: placed.x, y: placed.y } : h;
  });
}

// Match the model's placements back onto the scene's hotspots. Spots the model
// couldn't place keep their current coordinates. Returns
// { placements: [{ id, x, y }], unmatched: string[] }.
export function normalizeSpotPlacements(parsed, hotspots) {
  const byId = new Map((hotspots || []).filter((h) => h?.id).map((h) => [h.id, h.id]));
  const byLabel = new Map(
    (hotspots || [])
      .filter((h) => typeof h?.label === "string" && h.label.trim())
      .map((h) => [h.label.toLowerCase().trim(), h.id])
  );
  const placements = [];
  const unmatched = [];
  const seen = new Set();
  for (const p of Array.isArray(parsed?.placements) ? parsed.placements : []) {
    const id = String(p?.id || "");
    const x = Math.round(Math.min(95, Math.max(5, Number(p?.x) || 0)) * 10) / 10;
    const y = Math.round(Math.min(95, Math.max(5, Number(p?.y) || 0)) * 10) / 10;
    let hotspotId = byId.has(id) ? id : byLabel.get(id.toLowerCase().trim());
    if (!hotspotId || seen.has(hotspotId)) { unmatched.push(id || "(none)"); continue; }
    seen.add(hotspotId);
    placements.push({ id: hotspotId, x, y });
  }
  return { placements, unmatched };
}

// Coordinates reported by the painter itself: the image model returns the JSON
// next to the picture as text (buildSpotArtDirection asks for it). Tolerates
// fences, chatter and a "spots" key; a missing or malformed answer yields no
// placements — the vision pass then fills the gaps.
export function normalizePainterSpots(text, hotspots) {
  try {
    const parsed = parseLlmJson(text);
    return normalizeSpotPlacements({ placements: parsed?.placements || parsed?.spots || [] }, hotspots);
  } catch {
    return { placements: [], unmatched: [] };
  }
}

// Merge two placement passes over the same scene: the painter's own coordinates
// win; the vision pass fills only the spots the painter didn't report.
export function mergeSpotPlacements(primary, secondary) {
  const seen = new Set((primary || []).map((p) => p.id));
  return [...(primary || []), ...(secondary || []).filter((p) => !seen.has(p.id))];
}

// ── Globe worlds (view: "globe") ──────────────────────────────────────────────
// A globe topic opens on a 3D Earth instead of a picture; the superadmin grows
// it by naming places ("Pakistan", "Lahore") and the agent writes each scene
// plus the doorway spot pinned to the planet.

// Shell topic: the model writes only the shelf copy and the welcome narration;
// the places come later, one scene per request.
export function buildGlobeTopicPrompt({ title, angle = "" }) {
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for curious children aged 7-11. A new GLOBE world is being created: children will spin a 3D Earth and step inside the places a curator pins onto it.

Name the world and welcome its explorers.

Output ONLY a JSON object with exactly these fields:
{
  "title": "catchy world title (e.g. \\"Our Amazing Earth\\")",
  "tagline": "one exciting line for the shelf card",
  "emoji": "one emoji",
  "artStyle": "shared look for every place painting, one or two sentences: warm cinematic storybook illustration for children, wide 16:9 compositions, no text",
  "welcome": "2-3 sentences read aloud when a child lands on the globe — invite them to spin the Earth and tap a glowing place"${angle ? `\n\nThe curator's focus for this world: ${angle}` : ""}
}

STRICT RULES
1. Output ONLY the JSON object — no markdown fences, no commentary.
2. Warm, concrete, exciting for an 8-year-old. English only.`;
}

// Coerce the shell answer; every field falls back to a deterministic default so
// a flaky model answer can never block creating the world.
export function normalizeGlobeTopic(parsed, { title, angle = "" } = {}) {
  const p = parsed || {};
  return {
    title: String(p.title || title || "Our Amazing Earth").trim().slice(0, 80) || "Our Amazing Earth",
    tagline: String(p.tagline || `Spin the globe and step inside the places of${angle ? ` ${angle}` : " the world"}`).trim().slice(0, 120),
    emoji: String(p.emoji || "🌍").trim().slice(0, 8) || "🌍",
    artStyle: String(p.artStyle || "Warm, highly detailed cinematic digital illustration with a soft painterly finish, rich textures, child-friendly storybook realism, no text. Wide 16:9 composition.").trim(),
    welcome: String(p.welcome || "Spin the Earth and find a glowing place. Tap it to step inside and discover its story!").trim(),
  };
}

// The scene the agent writes when the curator names a place. The caller has
// already resolved WHERE the place is (gazetteer or LLM); this prompt only
// turns it into a child-friendly scene plus the doorway spot's wording.
const LEVEL_GUIDE = {
  country: "a SWEEPING LANDSCAPE MONTAGE of the country's most iconic scenery (mountains, rivers, cities, landmarks blended in one panorama)",
  city: "a PANORAMA of the city (its famous skyline or old town, streets, landmarks)",
  location: "a CLOSE-UP of this one famous place (building, monument, natural wonder) with its surroundings",
};

export function buildGlobeScenePrompt({ topicTitle, artStyle = "", place, existingNames = [] }) {
  const where = place.country && place.country.id !== place.id ? ` in ${place.country.name}` : "";
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for curious children aged 7-11. The topic is the globe world "${topicTitle}".

The curator just added the place "${place.name}"${where} (a ${place.level}) and it will be pinned on a 3D globe at latitude ${place.lat}, longitude ${place.lng}. Write the ONE scene a child steps into from that spot.

Design ONE scene about "${place.name}"${where}: what makes it wonderful, one or two things a child should know about it, and 3-5 hotspots (fact spots about real things there — places, animals, food, buildings, inventions). Every hotspot is a leaf: never set childSceneId.

STRICT RULES
1. Output ONLY a JSON object with exactly these fields:
{
  "scene": {
    "id": "kebab-case scene id starting with the place name",
    "title": "scene title including the place name",
    "artPrompt": "16:9 composition description: ${LEVEL_GUIDE[place.level] || LEVEL_GUIDE.location}. Spell out what sits left, centre, right and foreground. No text or letters in the picture.",
    "image": { "src": "", "alt": "one sentence describing the picture" },
    "narration": "2-4 sentences read aloud: where this place is${place.level !== "country" ? ` (which country/continent)` : ""} and why it is exciting",
    "hotspots": [
      { "id": "kebab-case-id", "label": "1-3 words", "blurb": "4-8 word teaser", "x": 50, "y": 50,
        "info": { "title": "...", "body": ["one short child-friendly paragraph", "a second if it helps"], "fact": "one surprising but TRUE fact" } }
    ]
  },
  "hotspot": { "label": "${place.name}", "blurb": "5-8 word teaser for the doorway on the globe" }
}
2. Geography must be right: the place is at ${place.lat}°${place.lat >= 0 ? "N" : "S"}, ${place.lng}°${place.lng >= 0 ? "E" : "W"}${where}. No invented facts or numbers.
3. Places this world already has (do not repeat them): ${existingNames.length ? existingNames.join(", ") : "none"}.
4. Warm, concrete, exciting for an 8-year-old. 3-5 hotspots, each with a true fun fact.
5. Output JSON only — no markdown fences, no commentary.`;
}

// Fallback place resolution for anything the gazetteer doesn't know: landmarks,
// neighborhoods, natural wonders — the language model supplies the coordinates.
export function buildPlaceResolutionPrompt({ query, topicTitle = "" }) {
  return `You are the geography editor for a children's 3D globe in the Wikido world "${topicTitle}". The curator typed a place; pin it on Earth.

Place: "${query}"

If this names a real place (city, town, landmark, monument, park, mountain, neighborhood — or a country), output ONLY this JSON, no fences or commentary:
{
  "name": "the place's proper display name",
  "level": "country" | "city" | "location",
  "countryId": "lowercase ISO-3166 alpha-2 code of the country it is in (e.g. \\"fr\\")",
  "lat": 48.8584,
  "lng": 2.2945,
  "note": "one short sentence: what this place is"
}

STRICT RULES
1. Use the place's real coordinates, 2 decimals at most. A capital or large city → level "city"; a smaller city/town → "city"; a landmark/building/natural site → "location"; a sovereign country → "country".
2. countryId must be the ISO code of the country the place belongs to TODAY.
3. If it is not a real geographic place, output { "error": "not a real place" }.`;
}

// Coerce + range-check the model's resolution. Returns
// { place: { name, level, countryId, lat, lng, note } | null, errors }.
export function normalizePlaceResolution(parsed) {
  const p = parsed || {};
  if (p.error) return { place: null, errors: [String(p.error)] };
  const name = String(p.name || "").trim().slice(0, 60);
  const level = isValidSpotLevel(p.level) ? p.level : "location";
  const lat = Math.round(Math.min(90, Math.max(-90, Number(p.lat))) * 100) / 100;
  const lng = Math.round(Math.min(180, Math.max(-180, Number(p.lng))) * 100) / 100;
  const errors = [];
  if (!name) errors.push("missing place name");
  if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) errors.push("missing coordinates");
  if (p.countryId !== undefined && p.countryId !== "" && !/^[a-z]{2}$/.test(String(p.countryId).toLowerCase())) {
    errors.push("countryId must be a 2-letter country code");
  }
  if (errors.length) return { place: null, errors };
  return {
    place: {
      name,
      level,
      countryId: String(p.countryId || "").toLowerCase() || null,
      lat,
      lng,
      note: String(p.note || "").trim().slice(0, 200),
    },
    errors: [],
  };
}

// The globe spot the agent pins onto the hub once the scene exists. The spot id
// must be unique within the hub (the caller de-duplicates).
export function buildGlobeHubSpot({ place, label, blurb, childSceneId, info }) {
  return {
    id: slugName(place.name) || slugify(place.name),
    label: String(label || place.name).slice(0, 60),
    blurb: String(blurb || `Step inside: ${place.name}`).slice(0, 90),
    lat: place.lat,
    lng: place.lng,
    level: place.level,
    ...(place.countryId ? { countryId: place.countryId } : place.country?.id ? { countryId: place.country.id } : {}),
    childSceneId,
    info,
  };
}
