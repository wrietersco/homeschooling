// Rule-level tests for the smart-blending pronunciation engine. Each case
// asserts the playable clip sequence for a row of sound ids — the exact
// audio a child hears when blocks join. Silent units are filtered out by
// clipsForIds; their structure is asserted directly via pronounceIds.
import { describe, expect, it } from "vitest";
import { clipsForIds, pronounceIds, rowSpeech, spellBySound, unitsForIds } from "./phonicsRules";

const clips = (...ids) => clipsForIds(ids);

describe("phonicsRules: digraph formation", () => {
  it("merges adjacent letters into digraphs", () => {
    expect(clips("s", "h", "i", "p")).toEqual(["sh", "i", "p"]);
    expect(clips("t", "h", "i", "n")).toEqual(["th", "i", "n"]);
    expect(clips("r", "i", "n", "g")).toEqual(["r", "i", "ng"]);
    expect(clips("d", "u", "c", "k")).toEqual(["d", "u", "ck"]);
  });

  it("leaves letters alone when no digraph applies", () => {
    expect(clips("c", "a", "t")).toEqual(["c", "a", "t"]);
    expect(clips("d", "o", "g")).toEqual(["d", "o", "g"]);
  });

  it("highlights merged tiles as one unit", () => {
    const units = pronounceIds(["s", "h", "i", "p"]);
    expect(units[0]).toMatchObject({ tileIdxs: [0, 1], clip: "sh" });
  });
});

describe("phonicsRules: c + h", () => {
  it("says /ch/ at word start (chat)", () => {
    expect(clips("c", "h", "a", "t")).toEqual(["ch", "a", "t"]);
  });

  it("says /ch/ at word end for ordinary words (lunch) — NOT /k/", () => {
    expect(clips("l", "u", "n", "c", "h")).toEqual(["l", "u", "n", "ch"]);
  });

  it("says /k/ in the Greek-origin family (school, chemistry, ache)", () => {
    expect(clips("s", "c", "h", "oo", "l")).toEqual(["s", "c", "oo", "l"]);
    expect(clips("c", "h", "e", "m", "i", "s", "t", "r", "y")).toEqual(["c", "e", "m", "i", "s", "t", "r", "ee"]);
    // a + ch + e → magic-e lengthens the a, ch says k: "ake"
    expect(clips("a", "c", "h", "e")).toEqual(["ai", "c"]);
  });

  it("disambiguates a ready-made ch tile the same way", () => {
    expect(clips("s", "ch", "oo", "l")).toEqual(["s", "c", "oo", "l"]);
    expect(clips("ch", "i", "n")).toEqual(["ch", "i", "n"]);
  });
});

describe("phonicsRules: vowel teams", () => {
  it("merges adjacent single vowels into teams", () => {
    expect(clips("r", "a", "i", "n")).toEqual(["r", "ai", "n"]);
    expect(clips("b", "o", "a", "t")).toEqual(["b", "oa", "t"]);
    expect(clips("f", "e", "e", "t")).toEqual(["f", "ee", "t"]);
    expect(clips("m", "o", "o", "n")).toEqual(["m", "oo", "n"]);
    expect(clips("c", "o", "i", "n")).toEqual(["c", "oi", "n"]);
  });

  it("merges r-controlled vowels", () => {
    expect(clips("s", "t", "a", "r")).toEqual(["s", "t", "ar"]);
    expect(clips("f", "o", "r", "k")).toEqual(["f", "or", "k"]);
    expect(clips("h", "e", "r")).toEqual(["h", "er"]);
  });

  it("merges trigraphs (igh, air, ear)", () => {
    expect(clips("l", "i", "g", "h", "t")).toEqual(["l", "igh", "t"]);
    expect(clips("h", "a", "i", "r")).toEqual(["h", "air"]);
    expect(clips("h", "e", "a", "r")).toEqual(["h", "ear"]);
  });

  it("says /ow/ as in cow by default, long-o in known words", () => {
    expect(clips("c", "o", "w")).toEqual(["c", "ow"]);
    expect(clips("s", "n", "o", "w")).toEqual(["s", "n", "oa"]);
    expect(clips("s", "n", "ow")).toEqual(["s", "n", "oa"]); // ow tile
  });
});

describe("phonicsRules: soft c and soft g", () => {
  it("c before e/i/y says /s/", () => {
    expect(clips("f", "a", "c", "e")).toEqual(["f", "ai", "s"]); // + magic e
    expect(clips("c", "i", "t", "y")).toEqual(["s", "i", "t", "ee"]);
    expect(clips("m", "i", "c", "e")).toEqual(["m", "igh", "s"]); // i_e → long i
  });

  it("g before e/i/y says /j/ in soft-g words but stays hard otherwise", () => {
    expect(clips("g", "e", "m")).toEqual(["j", "e", "m"]);
    expect(clips("m", "a", "g", "i", "c")).toEqual(["m", "a", "j", "i", "c"]);
    // bridge: two consonants before the e (dge ending) → short i, soft g, silent e
    expect(clips("b", "r", "i", "d", "g", "e")).toEqual(["b", "r", "i", "d", "j"]);
    expect(clips("g", "e", "t")).toEqual(["g", "e", "t"]); // hard-g exception
    expect(clips("g", "i", "f", "t")).toEqual(["g", "i", "f", "t"]);
  });
});

describe("phonicsRules: magic e", () => {
  it("lengthens the vowel and silences the final e", () => {
    expect(clips("c", "a", "k", "e")).toEqual(["c", "ai", "k"]);
    expect(clips("b", "i", "k", "e")).toEqual(["b", "igh", "k"]);
    expect(clips("h", "o", "m", "e")).toEqual(["h", "oa", "m"]);
    expect(clips("c", "u", "t", "e")).toEqual(["c", "oo", "t"]);
    expect(clips("t", "h", "e", "m", "e")).toEqual(["th", "ee", "m"]);
  });

  it("keeps the vowel short in irregular words", () => {
    expect(clips("h", "a", "v", "e")).toEqual(["h", "a", "v"]);
    expect(clips("g", "i", "v", "e")).toEqual(["g", "i", "v"]);
  });

  it("marks the magic-e structure explicitly", () => {
    const units = pronounceIds(["c", "a", "k", "e"]);
    const last = units[units.length - 1];
    expect(last.silent).toBe(true);
    expect(last.tileIdxs).toEqual([3]);
    expect(units.find((u) => u.tileIdxs.includes(1)).clip).toBe("ai");
  });
});

describe("phonicsRules: final e and final y", () => {
  it("final e is silent after a vowel team (care, more)", () => {
    expect(clips("c", "a", "r", "e")).toEqual(["c", "ar"]);
    expect(clips("m", "o", "r", "e")).toEqual(["m", "or"]);
  });

  it("a lone final e says /ee/ when it is the only vowel (me, she)", () => {
    expect(clips("m", "e")).toEqual(["m", "ee"]);
    expect(clips("sh", "e")).toEqual(["sh", "ee"]);
  });

  it("final y says /igh/ when the only vowel, /ee/ otherwise", () => {
    expect(clips("m", "y")).toEqual(["m", "igh"]);
    expect(clips("s", "k", "y")).toEqual(["s", "k", "igh"]);
    expect(clips("sh", "y")).toEqual(["sh", "igh"]);
    expect(clips("h", "a", "p", "p", "y")).toEqual(["h", "a", "p", "p", "ee"]);
    expect(clips("c", "i", "t", "y")).toEqual(["s", "i", "t", "ee"]);
  });
});

describe("phonicsRules: vowel pairs join into team sounds", () => {
  it("ay says long a", () => {
    expect(clips("d", "a", "y")).toEqual(["d", "ai"]);
    expect(clips("p", "l", "a", "y")).toEqual(["p", "l", "ai"]);
    expect(clips("t", "o", "d", "a", "y")).toEqual(["t", "o", "d", "ai"]);
  });

  it("ea says /ee/ normally but short e in the lexicon words", () => {
    expect(clips("s", "e", "a")).toEqual(["s", "ee"]);
    expect(clips("t", "e", "a", "ch", "er")).toEqual(["t", "ee", "ch", "er"]);
    expect(clips("h", "e", "a", "d")).toEqual(["h", "e", "d"]);
    expect(clips("b", "r", "e", "a", "d")).toEqual(["b", "r", "e", "d"]);
  });

  it("ie says long i at the end (or before -d), /ee/ inside", () => {
    expect(clips("p", "i", "e")).toEqual(["p", "igh"]);
    expect(clips("f", "r", "i", "e", "d")).toEqual(["f", "r", "igh", "d"]);
    expect(clips("f", "i", "e", "l", "d")).toEqual(["f", "ee", "l", "d"]);
  });

  it("oe and ue say long o and /oo/", () => {
    expect(clips("t", "o", "e")).toEqual(["t", "oa"]);
    expect(clips("g", "o", "e", "s")).toEqual(["g", "oa", "s"]);
    expect(clips("b", "l", "u", "e")).toEqual(["b", "l", "oo"]);
    expect(clips("c", "l", "u", "e")).toEqual(["c", "l", "oo"]);
  });

  it("ou says /ow/ by default but /oo/ in the lexicon words", () => {
    expect(clips("o", "u", "t")).toEqual(["ow", "t"]);
    expect(clips("s", "o", "u", "p")).toEqual(["s", "oo", "p"]);
    expect(clips("y", "o", "u")).toEqual(["y", "oo"]);
  });

  it("ir and ur say the er sound", () => {
    expect(clips("b", "i", "r", "d")).toEqual(["b", "er", "d"]);
    expect(clips("b", "u", "r", "n")).toEqual(["b", "er", "n"]);
    expect(clips("g", "i", "r", "l")).toEqual(["g", "er", "l"]); // g stays hard
  });

  it("ey says /ee/ normally, long a in the lexicon words", () => {
    expect(clips("k", "e", "y")).toEqual(["k", "ee"]);
    expect(clips("m", "o", "n", "k", "e", "y")).toEqual(["m", "o", "n", "k", "ee"]);
    expect(clips("th", "e", "y")).toEqual(["th", "ai"]);
  });

  it("a final e after a vowel team is silent (house, mouse, noise)", () => {
    expect(clips("h", "o", "u", "s", "e")).toEqual(["h", "ow", "s"]);
    expect(clips("m", "o", "u", "s", "e")).toEqual(["m", "ow", "s"]);
    expect(clips("n", "o", "i", "s", "e")).toEqual(["n", "oi", "s"]);
  });
});

describe("phonicsRules: ready-made digraph tiles coexist with merging", () => {
  it("treats a digraph tile as one unit", () => {
    expect(clips("sh", "ee", "p")).toEqual(["sh", "ee", "p"]);
    expect(clips("r", "ai", "n")).toEqual(["r", "ai", "n"]);
  });

  it("applies magic e across a digraph tile (snake spelled s-n-a-k-e still works)", () => {
    expect(clips("s", "n", "a", "k", "e")).toEqual(["s", "n", "ai", "k"]);
  });

  it("runs every rule together on longer words", () => {
    // "christmas" → k-r-i-s-t-m-a-s
    expect(clips("c", "h", "r", "i", "s", "t", "m", "a", "s")).toEqual(["c", "r", "i", "s", "t", "m", "a", "s"]);
    // "rainbow" → r-ai-n-b-oa(w)
    expect(clips("r", "a", "i", "n", "b", "o", "w")).toEqual(["r", "ai", "n", "b", "oa"]);
    // "bridge" → b-r-i-d-j (dge ending: short i, soft g, silent e)
    expect(clips("b", "r", "i", "d", "g", "e")).toEqual(["b", "r", "i", "d", "j"]);
  });
});

describe("phonicsRules: spellBySound — TTS respelling of blended sounds", () => {
  it("follows the same blending rules as playback", () => {
    expect(spellBySound(["c", "a", "t"])).toBe("kat");
    expect(spellBySound(["s", "h", "o", "p"])).toBe("shop");
    expect(spellBySound(["qu", "ee", "n"])).toBe("kween");
  });

  it("speaks nonsense builds as their formed sounds, not letter names", () => {
    expect(spellBySound(["x", "qu"])).toBe("kskw");
    expect(spellBySound(["v", "b", "g"])).toBe("vbg");
  });

  it("applies magic e and soft c to the respelling", () => {
    expect(spellBySound(["b", "i", "k", "e"])).toBe("byk");
    expect(spellBySound(["c", "i", "t"])).toBe("sit"); // soft c
  });
});

describe("phonicsRules: rowSpeech — phrase-aware speaking text", () => {
  it("speaks a plain word row as its dictionary word", () => {
    expect(rowSpeech(["c", "a", "t"])).toEqual({ text: "cat", realWords: 1 });
  });

  it("splits phrases on space blocks, joining segments with a space", () => {
    expect(rowSpeech(["c", "a", "t", "space", "s", "a", "t"])).toEqual({ text: "cat sat", realWords: 2 });
  });

  it("mixes dictionary words with sound-formed nonsense", () => {
    expect(rowSpeech(["x", "qu", "space", "d", "o", "g"])).toEqual({ text: "kskw dog", realWords: 1 });
  });

  it("a row of only spaces says nothing", () => {
    expect(rowSpeech(["space"])).toEqual({ text: "", realWords: 0 });
    expect(rowSpeech(["space", "space"])).toEqual({ text: "", realWords: 0 });
  });
});

describe("phonicsRules: unitsForIds — phrase-aware playback units", () => {
  it("skips space tiles and rebases tile indices to row coordinates", () => {
    const units = unitsForIds(["c", "a", "t", "space", "s", "a", "t"]);
    expect(units.map((u) => u.clip)).toEqual(["c", "a", "t", "s", "a", "t"]);
    // The second segment's tiles keep their row positions (4,5,6), not 0,1,2.
    expect(units[3].tileIdxs).toEqual([4]);
    expect(units[5].tileIdxs).toEqual([6]);
  });

  it("matches single-word pronunciation when there is no space", () => {
    expect(unitsForIds(["s", "h", "e", "e", "p"]).map((u) => u.clip)).toEqual(
      pronounceIds(["s", "h", "e", "e", "p"]).map((u) => u.clip),
    );
  });
});
