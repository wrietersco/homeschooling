// Sanity checks for the Phonics Playground data: the sound inventory must
// match the bundled audio files, every alphabet letter must map to at least
// one sound, and every celebration word must be spellable from the sounds a
// child can actually drag onto the canvas.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALPHA_BLOCKS,
  LETTERS,
  SOUNDS,
  SOUND_BY_ID,
  WORD_LIST,
  soundIdsForLetter,
  wordForIds,
} from "./phonicsData";

const CLIPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public/audio/phonics");

// Can `word` be spelled by concatenating sound glyphs (with repeats)?
function segmentable(word, glyphs) {
  const byLength = [...glyphs].sort((a, b) => b.length - a.length);
  const go = (rest) => {
    if (!rest) return true;
    return byLength.some((g) => rest.startsWith(g) && go(rest.slice(g.length)));
  };
  return go(word);
}

describe("phonicsData", () => {
  it("has unique sound ids with display letters", () => {
    const ids = SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOUNDS) expect(s.letters.length).toBeGreaterThan(0);
  });

  it("references an audio clip that exists on disk", () => {
    for (const s of SOUNDS) {
      expect(existsSync(join(CLIPS_DIR, `${s.clip}.m4a`)), `missing clip for ${s.id}`).toBe(true);
    }
  });

  it("maps every alphabet letter to at least one sound", () => {
    for (const letter of LETTERS) {
      expect(soundIdsForLetter(letter).length, `letter ${letter} has no sounds`).toBeGreaterThan(0);
    }
  });

  it("letter filtering only references real sound ids", () => {
    for (const letter of LETTERS) {
      for (const id of soundIdsForLetter(letter)) {
        expect(SOUND_BY_ID[id], `letter ${letter} references unknown sound ${id}`).toBeTruthy();
      }
    }
  });

  it("does not surface phonemes the letter never makes (ear is not an e sound)", () => {
    expect(soundIdsForLetter("e")).not.toContain("ear"); // ear is its own /ɪə/ phoneme
    expect(soundIdsForLetter("a")).not.toContain("air");
    expect(soundIdsForLetter("c")).not.toContain("ch"); // ch is /tʃ/, not c's /k/
    // …but same-sound spellings still belong to their letter
    expect(soundIdsForLetter("e")).toEqual(expect.arrayContaining(["e", "ee", "er"]));
    expect(soundIdsForLetter("c")).toEqual(expect.arrayContaining(["c", "ck"]));
    expect(soundIdsForLetter("q")).toContain("qu");
  });

  it("covers all 26 letters in the A–Z blocks", () => {
    expect(ALPHA_BLOCKS.map((b) => b.letter)).toEqual(LETTERS);
  });

  it("every celebration word is spellable from available sounds", () => {
    const glyphs = SOUNDS.map((s) => s.letters);
    const bad = WORD_LIST.filter((w) => !segmentable(w.toLowerCase(), glyphs));
    expect(bad, `unspellable words: ${bad.join(", ")}`).toEqual([]);
  });

  it("resolves joined rows to words (and rejects nonsense)", () => {
    expect(wordForIds(["c", "a", "t"])).toBe("cat");
    expect(wordForIds(["sh", "ee", "p"])).toBe("sheep");
    expect(wordForIds(["qu", "ee", "n"])).toBe("queen");
    expect(wordForIds(["t", "a", "c"])).toBe(""); // nonsense build
    expect(wordForIds(["c", "missing-id"])).toBe("");
  });

  it("looks sounds up by id", () => {
    expect(SOUND_BY_ID.sh.letters).toBe("sh");
    expect(SOUND_BY_ID.k.clip).toBe("c"); // k shares the /k/ recording
  });
});
