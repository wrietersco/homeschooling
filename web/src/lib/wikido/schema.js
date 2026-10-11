// Wikido content packs are hand-authored by developers (never runtime-generated),
// so the schema validator's job is to fail LOUDLY at load/test time when a pack is
// malformed — a typo'd scene reference or an out-of-range hotspot coordinate would
// otherwise surface to a child as a broken, silent screen.

// Hotspot x/y are PERCENTAGES of the scene image (0–100), so artwork can be
// re-exported at any resolution without re-measuring hotspots.
function isPercent(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
}

function isSlug(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

function slugFromLabel(label, fallback) {
  const s = String(label || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

// Light load-time repair for saved topics: a hotspot saved without an id (older
// studio saves) gets one derived from its label, with duplicates de-duplicated.
// Only trivially repairable gaps are fixed — everything else still fails
// validateTopicPack loudly. Returns the pack unchanged when nothing needs fixing.
export function normalizePackForLoad(pack) {
  if (!pack || typeof pack !== "object" || !pack.scenes) return pack;
  let changed = false;
  const scenes = {};
  for (const [sceneId, scene] of Object.entries(pack.scenes)) {
    const hotspots = [];
    const seen = new Set();
    for (const spot of scene?.hotspots || []) {
      let id = spot?.id;
      if (!id) { id = slugFromLabel(spot?.label, "spot"); changed = true; }
      let unique = id;
      let n = 2;
      while (seen.has(unique)) { unique = `${id}-${n++}`; changed = true; }
      seen.add(unique);
      hotspots.push(unique === spot?.id ? spot : { ...spot, id: unique });
    }
    scenes[sceneId] = hotspots === scene?.hotspots ? scene : { ...scene, hotspots };
  }
  return changed ? { ...pack, scenes } : pack;
}

function checkImage(img, path, errors) {
  if (!img || typeof img !== "object") {
    errors.push(`${path}: image must be an object { src, alt }`);
    return;
  }
  if (typeof img.src !== "string" || !img.src) errors.push(`${path}: image.src is required`);
  if (typeof img.alt !== "string" || !img.alt) errors.push(`${path}: image.alt is required`);
}

function checkInfo(info, path, errors) {
  if (!info || typeof info !== "object") {
    errors.push(`${path}: info { title, body } is required`);
    return;
  }
  if (typeof info.title !== "string" || !info.title.trim()) errors.push(`${path}: info.title is required`);
  if (!Array.isArray(info.body) || info.body.length === 0 || info.body.some((p) => typeof p !== "string" || !p.trim())) {
    errors.push(`${path}: info.body must be a non-empty array of paragraphs`);
  }
  if (info.fact !== undefined && (typeof info.fact !== "string" || !info.fact.trim())) {
    errors.push(`${path}: info.fact, when present, must be a non-empty string`);
  }
}

// Validates a full topic pack. Returns an array of human-readable error strings
// (empty = the pack is publishable).
export function validateTopicPack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") return ["pack must be an object"];
  if (!isSlug(pack.id)) errors.push(`id "${pack.id}" must be a kebab-case slug`);
  if (typeof pack.title !== "string" || !pack.title.trim()) errors.push("title is required");
  if (typeof pack.tagline !== "string" || !pack.tagline.trim()) errors.push("tagline is required");
  // hand-authored packs carry a shelf cover; studio packs may omit it and use
  // the root scene's artwork instead
  if (pack.cover !== undefined) checkImage(pack.cover, `${pack.id}.cover`, errors);
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
    checkImage(scene.image, path);
    if (typeof scene.narration !== "string" || !scene.narration.trim()) {
      errors.push(`${path}: narration (read-aloud text) is required`);
    }
    if (scene.audio !== undefined && (typeof scene.audio !== "string" || !scene.audio)) {
      errors.push(`${path}: audio, when present, must be an asset path`);
    }
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
      if (!isPercent(spot?.x) || !isPercent(spot?.y)) {
        errors.push(`${spotPath}: x/y must be percentages between 0 and 100`);
      }
      if (typeof spot.blurb !== "string" || !spot.blurb.trim()) errors.push(`${spotPath}: blurb (hover one-liner) is required`);
      checkInfo(spot.info, spotPath, errors);
      if (spot.audio !== undefined && (typeof spot.audio !== "string" || !spot.audio)) {
        errors.push(`${spotPath}: audio, when present, must be an asset path`);
      }
      if (spot.childSceneId !== undefined) {
        if (!isSlug(spot.childSceneId)) errors.push(`${spotPath}: childSceneId must be a scene slug`);
        else if (!scenes[spot.childSceneId]) {
          errors.push(`${spotPath}: childSceneId "${spot.childSceneId}" has no matching scene`);
        }
      }
    }
  }
  return errors;
}
