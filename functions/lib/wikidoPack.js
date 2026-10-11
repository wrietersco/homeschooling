// Wikido studio pack helpers — the server-side twin of web/src/lib/wikido/schema.js.
// The web copy is canonical for the runtime; keep the two shape rules in sync.
// These are PURE functions so they unit-test without network or Admin SDK.

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
    if (!isSlug(sceneId)) errors.push(`${path}: scene keys must be kebab-case slugs`);
    if (typeof scene.title !== "string" || !scene.title.trim()) errors.push(`${path}: title is required`);
    if (!scene.image || typeof scene.image !== "object") errors.push(`${path}: image { src, alt } is required`);
    else {
      if (!allowMissingArtwork && (typeof scene.image.src !== "string" || !scene.image.src)) errors.push(`${path}: image.src is required`);
      if (typeof scene.image.alt !== "string" || !scene.image.alt) errors.push(`${path}: image.alt is required`);
    }
    if (typeof scene.narration !== "string" || !scene.narration.trim()) errors.push(`${path}: narration is required`);
    if (!Array.isArray(scene.hotspots) || scene.hotspots.length === 0) {
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
      if (!isPercent(spot?.x) || !isPercent(spot?.y)) errors.push(`${spotPath}: x/y must be percentages between 0 and 100`);
      const info = spot.info;
      if (!info || typeof info !== "object") { errors.push(`${spotPath}: info { title, body } is required`); continue; }
      if (typeof info.title !== "string" || !info.title.trim()) errors.push(`${spotPath}: info.title is required`);
      if (!Array.isArray(info.body) || !info.body.length || info.body.some((p) => typeof p !== "string" || !p.trim())) {
        errors.push(`${spotPath}: info.body must be a non-empty array of paragraphs`);
      }
      if (info.fact !== undefined && (typeof info.fact !== "string" || !info.fact.trim())) {
        errors.push(`${spotPath}: info.fact, when present, must be a non-empty string`);
      }
      if (spot.childSceneId !== undefined) {
        if (!isSlug(spot.childSceneId)) errors.push(`${spotPath}: childSceneId must be a scene slug`);
        else if (!scenes[spot.childSceneId]) errors.push(`${spotPath}: childSceneId "${spot.childSceneId}" has no matching scene`);
      }
    }
  }
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
          ...(spot?.childSceneId ? { childSceneId: slugify(spot.childSceneId) } : {}),
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

const EXEMPLAR = `{
  "id": "the-water-cycle",
  "title": "The Water Cycle",
  "emoji": "💧",
  "tagline": "How a drop of water travels the whole world",
  "artStyle": "Warm, highly detailed cinematic digital illustration with a soft painterly finish, golden-hour lighting, rich textures, gentle atmospheric haze, child-friendly storybook realism, no text. Wide 16:9 composition.",
  "rootSceneId": "water-cycle-overview",
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
6. childSceneId must reference a scene id that exists in your "scenes" object. Scene ids and hotspot ids: kebab-case slugs.
7. The topic must work standalone: the first scene introduces the subject; the deepest scenes are close-ups or inner workings.
8. Accuracy matters — no myths, no made-up numbers.`;
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
3. The scene artPrompt must describe the picture composition explicitly (left/centre/right/foreground) so hotspots land on real landmarks. No text in the picture.
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

Plan about ${total} new scenes in total, at most ${depth} levels deep and at most ${OUTLINE_LIMITS.maxChildren} children under any scene. Each scene must zoom INTO one concrete, drawable thing. Order siblings by learning flow (what a child should meet first comes first); a child scene must build on its parent.

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
  const kind = spot?.childSceneId
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

export function buildDepthPrompt({ pack, maxScenes = 3 }) {
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
  return `You are the chief curator of "Wikido", an immersive picture-encyclopedia for children aged 7-11. The topic is "${pack.title}".

Here is the ENTIRE topic — every scene, what it teaches, and where its doorways lead:
${lines.join("\n")}

Assess it like a curator: which branches are too thin, which spots beg to be explored further, which big idea is missing? Then propose up to ${maxScenes} NEW deeper scenes at the most valuable places.

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
