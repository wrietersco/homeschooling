// Pronunciation rules for the Phonics Playground — the "smart blending"
// engine. When a child joins blocks into a row, the row is not sounded out
// tile-by-tile; this module groups the tiles into pronunciation UNITS and
// picks the right sound for each, applying beginner phonics rules:
//
//   • Digraph formation: adjacent single-letter tiles that spell one sound
//     blend into it — c+h, s+h, t+h, n+g, c+k, and the vowel teams ai, oa,
//     ee, oo, oi, ow, ar, or, er (+ trigraphs igh, air, ear).
//   • c+h pronunciation: /ch/ by default; /k/ in the Greek-origin word
//     family (school, echo, chemistry, …) — decided by lexicon, position
//     aware (word start defaults to /ch/; "lunch" stays /ch/).
//   • Soft c: c before e/i/y says /s/ (face, city, mice).
//   • Soft g: g before e/i/y says /j/ in known soft-g words (gem, magic,
//     fridge); hard-g exceptions (get, girl, give) are lexicon-listed.
//   • Magic e: V+C+e at word end → long vowel + silent e (cake, bike,
//     home); irregulars (have, love, come) keep the short vowel.
//   • Final e: silent after a vowel-team sound (care, more); says /ee/ when
//     it is the word's only vowel (me, she, we).
//   • Final y: /igh/ when the word's only vowel (my, try, sky); /ee/ when
//     another vowel exists (happy, city).
//   • ow disambiguation: /ow/ as in cow by default, /oa/ sound in known
//     long-o words (snow, yellow, window).
//
// Pure data-in/data-out over sound ids — fully unit-tested (see
// phonicsRules.test.js). The view plays each unit's clip and highlights all
// of the unit's tiles at once, so the child SEES which blocks merged.

import { SPACE_ID, SOUND_BY_ID, WORDS, wordForIds } from "./phonicsData";

// Words where "ch" is pronounced /k/ (Greek-origin family).
export const CH_SAYS_K = new Set([
  "school", "scheme", "scholar", "chemistry", "chorus", "choir", "christmas",
  "chrome", "chronic", "chronicle", "anchor", "echo", "ache", "stomach",
  "monarch", "orchid", "character", "technology", "sceptre", "scepter",
]);

// Words where "ow" is the long-o sound /oa/ rather than /ow/ as in cow.
export const OW_SAYS_OA = new Set([
  "snow", "low", "show", "grow", "blow", "flow", "glow", "slow", "throw",
  "tow", "row", "own", "bowl", "elbow", "below", "follow", "hollow",
  "yellow", "mellow", "pillow", "window", "shadow", "shallow", "meadow",
  "sparrow", "barrow", "arrow", "narrow", "rainbow", "snowman", "willow",
]);

// Words where g before e/i/y is SOFT (/j/).
export const SOFT_G_WORDS = new Set([
  "gem", "giant", "gentle", "germ", "generate", "gentle", "magic", "tragic",
  "page", "cage", "rage", "sage", "wage", "age", "huge", "edge", "hedge",
  "ledge", "ridge", "bridge", "fridge", "dodge", "budge", "nudge", "fudge",
  "legend", "region", "angel", "gentry", "agenda", "gymnast",
]);

// Common hard-g words that would otherwise look soft (g before e/i/y).
export const HARD_G_WORDS = new Set([
  "get", "girl", "give", "gift", "guitar", "giggle", "gills", "geese",
  "giddy", "gear", "begin", "together", "finger", "tiger", "anger", "angle",
  "single", "jungle", "hungry", "angry", "biggest", "gather", "gadget",
]);

// Magic-e irregulars: final e stays silent but does NOT lengthen the vowel.
export const NO_MAGIC_E = new Set([
  "have", "give", "live", "love", "come", "some", "one", "done", "gone",
  "none", "above",
]);

// Vowel-team disambiguation lexicons.
// "ea" says short e in these words (head, bread) instead of /ee/.
export const EA_SAYS_E = new Set([
  "head", "bread", "dead", "ready", "steady", "heavy", "health", "wealth",
  "weather", "feather", "leather", "breath", "sweat", "threat", "spread",
  "thread", "instead", "breadth",
]);
// "ou" says /oo/ in these words instead of /ow/.
export const OU_SAYS_OO = new Set(["you", "youth", "soup", "group"]);
// "ey" says long a in these words instead of /ee/.
export const EY_SAYS_AI = new Set(["they", "grey", "prey", "hey", "obey", "whey"]);

// Adjacent single-letter pairs that always form one sound (clip id per pair).
const PAIR_DIGRAPHS = {
  sh: "sh", th: "th", ng: "ng", ck: "ck",
  ai: "ai", oa: "oa", ee: "ee", oo: "oo", oi: "oi", ar: "ar", or: "or", er: "er",
};
const TRIGRAPHS = { igh: "igh", air: "air", ear: "ear" };

// Vowel-team clip ids — a final lone e is silent after one of these.
const VOWEL_TEAM_CLIPS = new Set(["ai", "oa", "ee", "oo", "oi", "ow", "ar", "or", "er", "air", "ear", "igh"]);
// Long-vowel clip for magic-e (a_e → ai sound, i_e → igh sound, …).
const LONG_FOR = { a: "ai", i: "igh", o: "oa", u: "oo", e: "ee" };
const VOWELS = "aeiou";

/**
 * Turn a row of sound ids into pronunciation units, left to right.
 * Each unit: { tileIdxs: [indices into the row], clip: soundId to play,
 *              label: human description, silent?: true }.
 * Silent units (magic-e, team-final e) cover their tile but play nothing.
 */
export function pronounceIds(ids) {
  const tokens = ids.map((id, i) => ({ id, glyph: (SOUND_BY_ID[id]?.letters || String(id)).toLowerCase(), i }));
  const word = tokens.map((t) => t.glyph).join("");
  const units = [];
  const consumed = new Array(ids.length).fill(false);
  const single = (t) => Boolean(t) && t.glyph.length === 1;

  // Vowel presence EXCLUDING the final tile (for final-y / final-e rules).
  const hasVowelBefore = (endExclusive) =>
    tokens.slice(0, endExclusive).some((t) => (single(t) && VOWELS.includes(t.glyph)) || VOWEL_TEAM_CLIPS.has(t.id));

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const next2 = tokens[i + 2];
    const isLast = i === tokens.length - 1;

    // ── Trigraph over three single tiles (igh, air, ear) ──────────────────
    if (single(t) && single(next) && single(next2)) {
      const tri = t.glyph + next.glyph + next2.glyph;
      if (TRIGRAPHS[tri]) {
        units.push({ tileIdxs: [i, i + 1, i + 2], clip: TRIGRAPHS[tri], label: tri });
        consumed[i] = consumed[i + 1] = consumed[i + 2] = true;
        i += 3;
        continue;
      }
    }

    // ── c + h → one sound: /ch/ normally, /k/ in the Greek-origin family ──
    if (single(t) && t.glyph === "c" && single(next) && next.glyph === "h") {
      const kSound = CH_SAYS_K.has(word);
      units.push({ tileIdxs: [i, i + 1], clip: kSound ? "c" : "ch", label: kSound ? "k (ch says k)" : "ch" });
      consumed[i] = consumed[i + 1] = true;
      i += 2;
      continue;
    }
    // A ready-made "ch" tile is disambiguated the same way.
    if (t.glyph === "ch") {
      const kSound = CH_SAYS_K.has(word);
      units.push({ tileIdxs: [i], clip: kSound ? "c" : "ch", label: kSound ? "k (ch says k)" : "ch" });
      consumed[i] = true;
      i += 1;
      continue;
    }
    // Same for a ready-made "ow" tile.
    if (t.glyph === "ow") {
      const oa = OW_SAYS_OA.has(word);
      units.push({ tileIdxs: [i], clip: oa ? "oa" : "ow", label: oa ? "oa (ow says oa)" : "ow" });
      consumed[i] = true;
      i += 1;
      continue;
    }

    // ── Soft c: c before e/i/y says /s/ ───────────────────────────────────
    if (single(t) && t.glyph === "c" && single(next) && "eiy".includes(next.glyph)) {
      units.push({ tileIdxs: [i], clip: "s", label: "s (soft c)" });
      consumed[i] = true;
      i += 1;
      continue;
    }

    // ── Soft g: g before e/i/y says /j/ — in listed soft-g words, or in any
    // known dictionary word that isn't a hard-g exception (get, girl, give…) ──
    if (
      single(t) && t.glyph === "g" && single(next) && "eiy".includes(next.glyph) &&
      (SOFT_G_WORDS.has(word) || (WORDS.has(word) && !HARD_G_WORDS.has(word)))
    ) {
      units.push({ tileIdxs: [i], clip: "j", label: "j (soft g)" });
      consumed[i] = true;
      i += 1;
      continue;
    }

    // ── Vowel pairs → team sound (ay→ai, ea→ee, ie, oe→oa, ue→oo, ou, ey,
    //    ir/ur→er). Sound-based mapping: the pair is spelled with two letters
    //    but PRONOUNCED like an existing sound clip. ─────────────────────────
    if (single(t) && single(next)) {
      const pair = t.glyph + next.glyph;
      const after = tokens[i + 2];
      // "ie" is word-final or inflected (-ied) → long i; inside the word → /ee/.
      const ieFinal = i + 1 === tokens.length - 1 ||
        (i + 2 === tokens.length - 1 && after && after.glyph === "d");
      let teamClip = null;
      if (pair === "ay") teamClip = "ai";
      else if (pair === "ea") teamClip = EA_SAYS_E.has(word) ? "e" : "ee";
      else if (pair === "ie") teamClip = ieFinal ? "igh" : "ee";
      else if (pair === "oe") teamClip = "oa";
      else if (pair === "ue") teamClip = "oo";
      else if (pair === "ou") teamClip = OU_SAYS_OO.has(word) ? "oo" : "ow";
      else if (pair === "ey") teamClip = EY_SAYS_AI.has(word) ? "ai" : "ee";
      else if (pair === "ir" || pair === "ur") teamClip = "er";
      if (teamClip) {
        units.push({ tileIdxs: [i, i + 1], clip: teamClip, label: `${pair} → ${teamClip}` });
        consumed[i] = consumed[i + 1] = true;
        i += 2;
        continue;
      }
    }

    // ── Pair digraphs (incl. vowel teams) ─────────────────────────────────
    if (single(t) && single(next)) {
      const pair = t.glyph + next.glyph;
      if (pair === "ow") {
        const oa = OW_SAYS_OA.has(word);
        units.push({ tileIdxs: [i, i + 1], clip: oa ? "oa" : "ow", label: oa ? "oa (ow says oa)" : "ow" });
        consumed[i] = consumed[i + 1] = true;
        i += 2;
        continue;
      }
      if (PAIR_DIGRAPHS[pair]) {
        units.push({ tileIdxs: [i, i + 1], clip: PAIR_DIGRAPHS[pair], label: pair });
        consumed[i] = consumed[i + 1] = true;
        i += 2;
        continue;
      }
    }

    // ── Final e rules ─────────────────────────────────────────────────────
    if (isLast && single(t) && t.glyph === "e" && tokens.length >= 2) {
      const pushSilent = (label) => {
        units.push({ tileIdxs: [i], clip: "e", label, silent: true });
        consumed[i] = true;
        i += 1;
      };
      // Unit-shape helpers (units are sounds, so "ch" in ache = ONE consonant).
      const isLoneVowelUnit = (u) => u && u.tileIdxs.length === 1 && VOWELS.includes(tokens[u.tileIdxs[0]].glyph);
      const isVowelSoundUnit = (u) => u && (isLoneVowelUnit(u) || VOWEL_TEAM_CLIPS.has(u.clip));
      const prevUnit = units[units.length - 1];

      // Irregulars (have, love…): e silent, vowel unchanged.
      if (NO_MAGIC_E.has(word)) {
        pushSilent("silent e");
        continue;
      }
      // Magic e: exactly one consonant SOUND between a vowel and the final
      // e. A LONE vowel lengthens (cake); a vowel TEAM just silences the e
      // (house, noise — the team is already long). Looking at units (not
      // tile offsets) makes this work across digraphs: "ache" is a + [ch] +
      // e just like "cake" is c + a + k + e.
      if (prevUnit && !isVowelSoundUnit(prevUnit)) {
        const vowelUnit = units[units.length - 2];
        const vowelGlyph = vowelUnit && isLoneVowelUnit(vowelUnit) ? tokens[vowelUnit.tileIdxs[0]].glyph : null;
        if (vowelGlyph && LONG_FOR[vowelGlyph]) {
          units[units.length - 2] = { tileIdxs: vowelUnit.tileIdxs, clip: LONG_FOR[vowelGlyph], label: `${vowelGlyph} (magic e → long ${vowelGlyph})` };
          pushSilent("silent e (magic e)");
          continue;
        }
        if (vowelUnit && isVowelSoundUnit(vowelUnit)) {
          pushSilent("silent e");
          continue;
        }
      }
      // After a vowel-team sound the final e is silent (care, more, phone)…
      if (prevUnit && VOWEL_TEAM_CLIPS.has(prevUnit.clip)) {
        pushSilent("silent e");
        continue;
      }
      // …and so is the -ce / -ge ending (lace, page, bridge).
      if (prevUnit && /soft/.test(prevUnit.label)) {
        pushSilent("silent e");
        continue;
      }
      // Only vowel in the word → e says /ee/ (me, she, we).
      if (!hasVowelBefore(i)) {
        units.push({ tileIdxs: [i], clip: "ee", label: "ee (e says ee)" });
        consumed[i] = true;
        i += 1;
        continue;
      }
    }

    // ── Final y rules ─────────────────────────────────────────────────────
    if (isLast && single(t) && t.glyph === "y" && tokens.length >= 2) {
      if (!hasVowelBefore(i)) {
        units.push({ tileIdxs: [i], clip: "igh", label: "igh (y says eye)" });
      } else {
        units.push({ tileIdxs: [i], clip: "ee", label: "ee (y says ee)" });
      }
      consumed[i] = true;
      i += 1;
      continue;
    }

    // ── Default: the tile's own sound ─────────────────────────────────────
    units.push({ tileIdxs: [i], clip: t.id, label: t.glyph });
    consumed[i] = true;
    i += 1;
  }
  return units;
}

// Convenience: just the playable clip ids in order (skips silent units).
export function clipsForIds(ids) {
  return pronounceIds(ids).filter((u) => !u.silent).map((u) => u.clip);
}

// ── Speaking what the child built ───────────────────────────────────────────
// A TTS-friendly respelling of each sound clip: simple letter combinations a
// speech engine reads with (approximately) the intended sound. Used only when
// a build ISN'T a dictionary word, so nonsense like "xq" is still heard as
// its blended sounds (/ks/ /kw/) rather than spelled out as letter names.
const CLIP_SAYS = {
  a: "a", b: "b", c: "k", d: "d", e: "e", f: "f", g: "g", h: "h", i: "i", j: "j",
  k: "k", l: "l", m: "m", n: "n", o: "o", p: "p", qu: "kw", r: "r", s: "s",
  t: "t", u: "u", v: "v", w: "w", x: "ks", y: "y", z: "z",
  ck: "k", sh: "sh", ch: "ch", th: "th", ng: "ng",
  ee: "ee", oo: "oo", ai: "ay", oa: "oh", ar: "ar", or: "or", ow: "ow",
  oi: "oy", igh: "y", air: "air", ear: "eer", er: "er",
};

// What a row of sound ids SOUNDS like, spelled for TTS voices. Follows the
// same smart-blending rules as playback (digraphs merge, magic e lengthens),
// so "c,a,t" → "kat" and "x,qu" → "kskw".
export function spellBySound(ids) {
  return pronounceIds(ids)
    .filter((u) => !u.silent)
    .map((u) => CLIP_SAYS[u.clip] ?? SOUND_BY_ID[u.clip]?.letters ?? u.label)
    .join("");
}

// Split a row into space-free segments (a row without spaces is one segment).
function segmentsOf(ids) {
  const segments = [];
  let cur = [];
  for (const id of ids) {
    if (id === SPACE_ID) {
      segments.push(cur);
      cur = [];
    } else cur.push(id);
  }
  segments.push(cur);
  return segments;
}

// The text a whole row should be SPOKEN as: each segment as its dictionary
// word when it is one, otherwise its sound-formed respelling; segments are
// joined with spaces. `realWords` counts dictionary-word segments (drives
// celebration). A row of just spaces yields empty text.
export function rowSpeech(ids) {
  const segments = segmentsOf(ids).filter((s) => s.length);
  const parts = segments.map((s) => wordForIds(s) || spellBySound(s));
  return {
    text: parts.join(" "),
    realWords: segments.filter((s) => wordForIds(s)).length,
  };
}

// Pronunciation units for a whole row, phrase-aware: each space-free segment
// is pronounced with its own rules (so final-e / final-y / lexicon checks
// never leak across a space) and tile indices are rebased to row coordinates.
export function unitsForIds(ids) {
  const out = [];
  let seg = [];
  let base = 0;
  const flush = () => {
    for (const u of pronounceIds(seg)) {
      out.push({ ...u, tileIdxs: u.tileIdxs.map((i) => i + base) });
    }
    base += seg.length;
    seg = [];
  };
  for (const id of ids) {
    if (id === SPACE_ID) {
      flush();
      base += 1;
    } else seg.push(id);
  }
  flush();
  return out;
}
