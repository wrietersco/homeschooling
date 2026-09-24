// Data for the Phonics Playground (/phonics) — a free-play sound-building game
// any child can use, with no curriculum assignment attached.
//
// A "sound" is one grapheme-phoneme correspondence (GPC): a single letter sound
// (/b/) or a digraph (/sh/). Every sound maps to a short recorded "pure sound"
// clip bundled under /audio/phonics/ (see ATTRIBUTION.md there — clips come
// from the MIT-licensed Buzzphonics project, UK synthetic-phonics style).
//
// Drag & drop joins these sounds into words on the canvas; the whole-word voice
// ("cat!") comes from the shared useSpeech() TTS composable.

export const CLIP_BASE = "/audio/phonics/";

// Candy palette — background + darker shade of the same hue. The dark shade is
// used for borders / 3D bottom edge / text so contrast stays readable on every
// pastel-candy background.
export const PALETTE = [
  { bg: "#FF8FB1", deep: "#D6457C" }, // pink
  { bg: "#FFB25A", deep: "#C96F1E" }, // orange
  { bg: "#FFE45C", deep: "#A98608" }, // yellow
  { bg: "#7FE3A6", deep: "#1E9E5C" }, // green
  { bg: "#6FD3FF", deep: "#1D7FBE" }, // blue
  { bg: "#C39BFF", deep: "#7B3FD1" }, // purple
  { bg: "#FF9D7A", deep: "#D1502A" }, // coral
  { bg: "#6FE3D2", deep: "#149485" }, // teal
];

// Stable per-id color so a sound always looks the same everywhere it appears
// (panel chip, alphabet block, canvas tile).
export function colorFor(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// The draggable phoneme inventory shown in the bottom panel. `clip` is the file
// stem in /audio/phonics/; `from` lists the alphabet letters that map to this
// sound and drives filtering between the two panels in BOTH directions.
export const SOUNDS = [
  { id: "a", letters: "a", clip: "a", from: ["a"] },
  { id: "b", letters: "b", clip: "b", from: ["b"] },
  { id: "c", letters: "c", clip: "c", from: ["c"] },
  { id: "d", letters: "d", clip: "d", from: ["d"] },
  { id: "e", letters: "e", clip: "e", from: ["e"] },
  { id: "f", letters: "f", clip: "f", from: ["f"] },
  { id: "g", letters: "g", clip: "g", from: ["g"] },
  { id: "h", letters: "h", clip: "h", from: ["h"] },
  { id: "i", letters: "i", clip: "i", from: ["i"] },
  { id: "j", letters: "j", clip: "j", from: ["j"] },
  { id: "k", letters: "k", clip: "c", from: ["k"] }, // k shares the /k/ recording
  { id: "l", letters: "l", clip: "l", from: ["l"] },
  { id: "m", letters: "m", clip: "m", from: ["m"] },
  { id: "n", letters: "n", clip: "n", from: ["n"] },
  { id: "o", letters: "o", clip: "o", from: ["o"] },
  { id: "p", letters: "p", clip: "p", from: ["p"] },
  { id: "qu", letters: "qu", clip: "qu", from: ["q"] }, // q is taught as /kw/
  { id: "r", letters: "r", clip: "r", from: ["r"] },
  { id: "s", letters: "s", clip: "s", from: ["s"] },
  { id: "t", letters: "t", clip: "t", from: ["t"] },
  { id: "u", letters: "u", clip: "u", from: ["u"] },
  { id: "v", letters: "v", clip: "v", from: ["v"] },
  { id: "w", letters: "w", clip: "w", from: ["w"] },
  { id: "x", letters: "x", clip: "x", from: ["x"] },
  { id: "y", letters: "y", clip: "y", from: ["y"] },
  { id: "z", letters: "z", clip: "z", from: ["z"] },
  // Digraphs & trigraphs (UK Phase 2/3/5 set that ships with the clip pack)
  { id: "ck", letters: "ck", clip: "c", from: ["c", "k"] },
  { id: "sh", letters: "sh", clip: "sh", from: ["s", "h"] },
  { id: "ch", letters: "ch", clip: "ch", from: ["c", "h"] },
  { id: "th", letters: "th", clip: "th", from: ["t", "h"] },
  { id: "ng", letters: "ng", clip: "ng", from: ["n", "g"] },
  { id: "ee", letters: "ee", clip: "ee", from: ["e"] },
  { id: "oo", letters: "oo", clip: "oo", from: ["o"] },
  { id: "ai", letters: "ai", clip: "ai", from: ["a"] },
  { id: "oa", letters: "oa", clip: "oa", from: ["o"] },
  { id: "ar", letters: "ar", clip: "ar", from: ["a", "r"] },
  { id: "or", letters: "or", clip: "or", from: ["o", "r"] },
  { id: "ow", letters: "ow", clip: "ow", from: ["o", "w"] },
  { id: "oi", letters: "oi", clip: "oi", from: ["o", "i"] },
  { id: "igh", letters: "igh", clip: "igh", from: ["i"] },
  { id: "air", letters: "air", clip: "air", from: ["a", "i"] },
  { id: "ear", letters: "ear", clip: "ear", from: ["e", "a"] },
  { id: "er", letters: "er", clip: "er", from: ["e", "r"] },
];

export const SOUND_BY_ID = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

// The phrase space: not a sound — an empty block the child inserts with the
// spacebar to mark a word gap. It lives in SOUND_BY_ID so every tile path
// (drag, snap, extract, trash, coloring) treats it like any other block, but
// deliberately NOT in the SOUNDS list so palette loops (clip preloading, the
// inventory itself) skip it.
export const SPACE_ID = "space";
SOUND_BY_ID[SPACE_ID] = { id: SPACE_ID, letters: " ", clip: "space", from: [] };

export const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

// Letter → sound ids shown when a child taps an alphabet block. Curated, not
// derived from `from` (which is visual letter containment for the reverse
// direction): a letter only lists sounds the letter itself genuinely makes —
// its short sound, its long-sound digraph spellings, and same-phoneme
// spellings. So `e` surfaces e/ee/er (egg / me / her) but NOT "ear": ear is
// its own /ɪə/ phoneme that the letter e never makes on its own.
export const LETTER_TO_SOUNDS = {
  a: ["a", "ai"], // cat; rain (long a)
  b: ["b"],
  c: ["c", "ck"], // both /k/
  d: ["d"],
  e: ["e", "ee", "er"], // egg; me; her
  f: ["f"],
  g: ["g"],
  h: ["h"],
  i: ["i", "igh"], // pig; light (long i)
  j: ["j"],
  k: ["k", "ck"],
  l: ["l"],
  m: ["m"],
  n: ["n"],
  o: ["o", "oa", "oo"], // hot; boat; do (long oo)
  p: ["p"],
  q: ["qu"],
  r: ["r"],
  s: ["s"],
  t: ["t"],
  u: ["u"],
  v: ["v"],
  w: ["w"],
  x: ["x"],
  y: ["y"],
  z: ["z"],
};

export const soundIdsForLetter = (letter) => LETTER_TO_SOUNDS[letter] || [];

// A–Z alphabet blocks, each with a stable candy color.
export const ALPHA_BLOCKS = LETTERS.map((l) => ({ letter: l, color: colorFor(l + "block") }));

// Words the playground celebrates. Every entry must be spellable by
// concatenating the `letters` of available sounds (see phonicsData.spec.js).
export const WORD_LIST = [
  // CVC — a
  "cat", "bat", "rat", "mat", "hat", "fat", "pat", "sat", "can", "man", "pan", "fan", "van", "ban",
  "ran", "cap", "map", "nap", "tap", "lap", "gap", "bad", "dad", "had", "mad", "pad", "sad", "bag",
  "rag", "tag", "wag", "jam", "yam", "wax",
  // CVC — e
  "bed", "red", "fed", "led", "wed", "bet", "get", "jet", "let", "met", "net", "pet", "set", "wet",
  "yet", "hen", "den", "men", "pen", "ten", "peg", "leg", "beg", "keg", "web", "hem",
  // CVC — i
  "big", "dig", "pig", "wig", "fig", "bit", "fit", "hit", "kit", "lit", "pit", "sit", "bin", "fin",
  "pin", "tin", "win", "hip", "lip", "rip", "sip", "tip", "zip", "dip", "hid", "kid", "lid", "rid",
  "bib", "rib",
  // CVC — o
  "dog", "log", "fog", "jog", "hop", "top", "mop", "pop", "cop", "pot", "not", "hot", "dot", "got",
  "lot", "rot", "nod", "rod", "cod", "pod", "box", "fox", "ox", "mix", "six", "fix", "mob", "cob",
  "sob", "rob",
  // CVC — u
  "bus", "bug", "cub", "tub", "rub", "hub", "gum", "hum", "sum", "mum", "sun", "bun", "fun", "gun",
  "run", "nun", "cup", "pup", "mud", "bud", "hug", "jug", "mug", "rug", "tug", "dug", "hut", "cut",
  "but", "gut", "nut", "jug",
  // CCVC / CVCC
  "stop", "spot", "spin", "spit", "step", "sled", "snap", "snip", "ship", "shop", "shed", "shut",
  "shin", "fish", "wish", "dish", "cash", "dash", "chat", "chin", "chip", "chop", "much", "such",
  "rich", "lunch", "thin", "moth", "bath", "path", "with", "thick", "drip", "crab", "frog", "drum",
  "plum", "slug", "plan", "clap", "grab", "trip", "grin", "spot", "swim", "stem", "glad", "flat",
  "black", "clock", "crust", "stamp", "swim", "trap", "twin",
  // ng
  "ring", "king", "sing", "wing", "sang", "sung", "lung", "long", "song", "gong", "hang", "bang",
  "rang", "thing", "bring", "sting", "strong",
  // ee / oo
  "see", "bee", "feet", "seed", "need", "feed", "deep", "keep", "week", "sleep", "sheep", "green",
  "tree", "three", "jeep", "sweep", "moon", "soon", "food", "mood", "root", "boot", "hoot", "zoo",
  "cool", "pool", "tool", "wool", "spoon", "broom",
  // ai / oa
  "rain", "main", "pain", "brain", "train", "chain", "tail", "nail", "pail", "sail", "mail", "snail",
  "road", "load", "toad", "goat", "coat", "boat", "soap", "foam", "loaf",
  // ar / or
  "car", "bar", "far", "jar", "tar", "star", "scar", "dark", "park", "yard", "farm", "hard", "card",
  "fork", "corn", "horn", "born", "torn", "port", "sort", "fort", "short", "sport", "storm",
  // ow / oi
  "cow", "how", "now", "bow", "row", "low", "own", "owl", "coin", "boil", "soil", "coil", "oil",
  "join", "point", "town", "down", "brown", "clown", "crown",
  // igh / air / ear / er
  "high", "sigh", "night", "light", "right", "sight", "fight", "might", "bright", "fright", "air",
  "hair", "fair", "pair", "chair", "ear", "hear", "near", "year", "beard", "her", "herd", "river",
  "summer", "tiger", "water", "under", "letter", "dinner",
  // qu / x / y / z fun ones
  "queen", "quit", "quiz", "quick", "quack", "yes", "yak", "yell", "zip", "zap", "zigzag",
  // ── Words added for the smart-blending rules (each must be spellable AND
  //    correctly pronounced by phonicsRules.js — see phonicsRules.test.js) ──
  // Magic e (long vowel + silent e)
  "cake", "bake", "lake", "make", "take", "wake", "snake", "grape", "plate", "gate", "late",
  "date", "name", "game", "same", "cave", "wave", "save", "bike", "like", "hike", "kite",
  "bite", "time", "lime", "dime", "nine", "line", "mine", "fine", "vine", "dive", "five",
  "hive", "drive", "prize", "smile", "home", "hope", "nose", "rose", "rope", "note", "bone",
  "stone", "cone", "zone", "joke", "poke", "pole", "hole", "vote", "cute", "cube", "june",
  "rule", "mule", "flute", "these", "theme",
  // Soft c (c before e/i/y says /s/)
  "face", "lace", "race", "mice", "nice", "rice", "ice", "spice", "twice", "pace", "space",
  "place", "grace", "trace", "price", "prince", "since", "dance", "city", "pity",
  // Soft g (g before e/i/y says /j/)
  "gem", "magic", "page", "cage", "age", "rage", "sage", "wage", "huge", "edge", "hedge",
  "ledge", "ridge", "bridge", "fridge", "dodge",
  // ch says /k/ (Greek-origin family)
  "school", "ache", "anchor", "stomach", "chemistry", "chorus", "christmas", "character",
  "monarch", "orchid",
  // ow says long-o
  "snow", "show", "grow", "blow", "flow", "glow", "slow", "throw", "tow", "bowl", "elbow",
  "below", "follow", "hollow", "yellow", "mellow", "pillow", "window", "shadow", "shallow",
  "meadow", "sparrow", "arrow", "narrow", "rainbow", "willow",
  // Final y (/igh/ or /ee/)
  "my", "by", "try", "fly", "sky", "cry", "dry", "spy", "shy", "silly", "happy", "funny",
  "sunny", "bunny", "puppy",
  // ── Vowel-team joining (each verified in phonicsRules.test.js) ──
  // ay → long a
  "day", "play", "say", "may", "way", "tray", "stay", "clay", "gray", "grey", "away",
  "spray", "today", "birthday",
  // ea → /ee/ (and short-e lexicon)
  "sea", "tea", "pea", "eat", "meat", "seat", "beat", "team", "read", "leaf", "beach",
  "peach", "teach", "clean", "dream", "cream", "steam", "teacher", "head", "bread",
  "ready",
  // ie → long i finally, /ee/ inside
  "pie", "tie", "lie", "die", "tried", "fried", "field",
  // oe / ue
  "toe", "hoe", "goes", "blue", "true", "glue", "clue",
  // ou → /ow/ (and /oo/ lexicon)
  "out", "house", "mouse", "loud", "cloud", "shout", "found", "round", "sound",
  "ground", "soup", "group",
  // ir / ur → er sound
  "bird", "girl", "shirt", "skirt", "dirt", "first", "third", "fur", "burn", "turn",
  "hurt", "curl", "surf",
  // ey → /ee/ (and long-a lexicon)
  "key", "monkey", "donkey", "honey", "they", "hey",
];

export const WORDS = new Set(WORD_LIST.map((w) => w.toLowerCase()));

// The word a row of sound ids spells, or "" if it isn't a dictionary word.
export function wordForIds(ids) {
  const w = ids.map((id) => SOUND_BY_ID[id]?.letters ?? "").join("").toLowerCase();
  return WORDS.has(w) ? w : "";
}
