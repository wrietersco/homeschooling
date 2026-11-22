// Pure helpers behind the "Add a scene" wizard. No Vue, no network — unit-tested.
import { buildSceneTree } from "./tree";

export const MAX_SPOTS = 8; // a picture holds at most 8 spots

export const SCENE_STEPS = ["where", "what", "review", "create", "next"];
export const SCENE_STEP_TITLES = {
  where: "Where does it go?",
  what: "What is it about?",
  review: "Check and create",
  create: "Writing your scene",
  next: "What's next",
};
export const SCENE_STEP_HELP = {
  where: "Every scene opens from a spot on another scene's picture. Choose that parent scene.",
  what: "Say what the new scene should be about — or let the studio think of ideas.",
  review: "This is exactly what will be created. Nothing is published.",
  create: "The studio is writing the scene for you. Please keep this window open.",
  next: "Your scene exists. Here is what is done and what is left.",
};

export const MODES = [
  { id: "ideas", emoji: "✨", label: "Suggest ideas for me", help: "The studio proposes a few scenes that fit. You pick one." },
  { id: "type", emoji: "✍️", label: "I'll type it", help: "You give the name and what it should teach." },
  { id: "branch", emoji: "🌿", label: "A whole branch", help: "Several scenes at once, shown as an outline you can edit first." },
];

export const NAME_EXAMPLES = ["Inside a Volcano", "How Bees Make Honey", "A Day in a Castle"];
export const FOCUS_EXAMPLES = ["how lava is made", "why bees dance", "who lived there long ago"];

export const spotRoom = (pack, sceneId) => Math.max(0, MAX_SPOTS - (pack?.scenes?.[sceneId]?.hotspots?.length || 0));

// "Our Amazing Earth › United Kingdom › London" — the tree path of a scene.
export function scenePath(pack, sceneId) {
  const rows = buildSceneTree(pack?.scenes, pack?.rootSceneId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names = [];
  const seen = new Set();
  let cur = byId.get(sceneId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(pack.scenes[cur.id]?.title || cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return names;
}

// Every scene that could be a parent, with its path and why it may be disabled.
//   globe worlds: the hub is the planet (places are added with "Add a place").
export function parentChoices(pack, query = "") {
  const q = query.trim().toLowerCase();
  const rows = buildSceneTree(pack?.scenes, pack?.rootSceneId);
  return rows
    .filter((r) => !(pack?.view === "globe" && r.id === pack.rootSceneId))
    .map((r) => {
      const path = scenePath(pack, r.id);
      const room = spotRoom(pack, r.id);
      return {
        id: r.id,
        depth: r.depth,
        title: pack.scenes[r.id].title || r.id,
        path,
        pathText: path.join(" › "),
        room,
        full: room === 0,
      };
    })
    .filter((c) => !q || c.pathText.toLowerCase().includes(q));
}

// What the "what is it about" step still needs before Next works.
export function whatBlock({ mode, label, focus, picked, outlineCount, room, topLevel, busy }) {
  if (busy) return "Thinking — one moment…";
  if (!mode) return "Choose how you want to start.";
  if (mode === "ideas") return picked || label.trim() ? "" : "Press “Get ideas”, then click the one you like.";
  if (mode === "type") return label.trim() || focus.trim() ? "" : "Type a name, or what it should teach.";
  if (!outlineCount) return "Press “Draft an outline”, then edit it.";
  if (topLevel > room) return `The parent picture only has room for ${room} more ${room === 1 ? "spot" : "spots"} — remove ${topLevel - room} from the top level.`;
  return "";
}

// The five things a new scene needs, for the finish screen.
export function sceneChecklist(pack, sceneId, topicStatus = "draft") {
  const scene = pack?.scenes?.[sceneId];
  const parentHas = Object.values(pack?.scenes || {}).some((s) => (s.hotspots || []).some((h) => h.childSceneId === sceneId && !h.childTopicId));
  const artwork = Boolean(scene) && /^(https?:\/\/|\/wikido\/)/.test(String(scene.image?.src || ""));
  const voice = Boolean(scene?.audio);
  const published = topicStatus === "published";
  const missing = [];
  if (!scene) missing.push("scene");
  if (scene && !parentHas) missing.push("spot");
  if (scene && !artwork) missing.push("artwork");
  if (scene && !voice) missing.push("voice");
  if (!published) missing.push("published");
  return { scene: Boolean(scene), artwork, voice, spot: parentHas, published, missing, next: missing[0] || "" };
}

// Combined progress across several new scenes (a branch).
export function branchChecklist(pack, sceneIds, topicStatus = "draft") {
  const each = sceneIds.map((id) => sceneChecklist(pack, id, topicStatus));
  const n = each.length;
  return {
    total: n,
    scenes: each.filter((c) => c.scene).length,
    artwork: each.filter((c) => c.artwork).length,
    voice: each.filter((c) => c.voice).length,
    spots: each.filter((c) => c.spot).length,
    published: topicStatus === "published",
  };
}

// Words for the Create step's progress, in order.
export const CREATE_NOTES = [
  "Reading the parent scene…",
  "Thinking up the scene's story…",
  "Writing explanations children can follow…",
  "Adding spots and fun facts…",
  "Linking it onto the parent picture…",
];
