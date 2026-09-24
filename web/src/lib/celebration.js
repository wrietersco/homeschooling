// How the Explore buddy celebrates a child's win. Parents pick one per child
// (and per mode) in Buddy settings. Every sound is a file SAVED in the app
// (web/public/audio/celebrate, built once by functions/scripts/buildCelebrationSounds.mjs)
// or synthesised on the device ("chime") — nothing is generated at runtime.
//
// The server keeps its own copy of the values (CELEBRATIONS in
// functions/agents/explore.js); a test keeps the two lists in step.
export const CELEBRATION_SOUNDS = [
  { value: "mashallah_clap", label: "“Masha’Allah! Well done!” + clapping", src: "/audio/celebrate/mashallah-clap.wav" },
  { value: "mashallah", label: "“Masha’Allah! Well done!”", src: "/audio/celebrate/mashallah.wav" },
  { value: "barakallah", label: "“Barak Allahu feek! Amazing!”", src: "/audio/celebrate/barakallah.wav" },
  { value: "clapping", label: "Clapping", src: "/audio/celebrate/clapping.wav" },
  { value: "cheer", label: "“Yay! You did it!”", src: "/audio/celebrate/cheer.wav" },
  { value: "chime", label: "Happy chime", src: null },
  { value: "mix", label: "Surprise me — a different one each time", src: null },
  { value: "none", label: "No sound (confetti and balloons only)", src: null },
];
export const DEFAULT_CELEBRATION = "mashallah_clap";
export const CELEBRATION_VALUES = CELEBRATION_SOUNDS.map((s) => s.value);

// The recordings "mix" rotates through.
export const MIX_POOL = CELEBRATION_SOUNDS.filter((s) => s.src);

// The files a session needs loaded before the first win, for a given choice.
export function celebrationSources(choice) {
  if (choice === "mix") return MIX_POOL.map((s) => s.src);
  const s = CELEBRATION_SOUNDS.find((o) => o.value === choice);
  return s?.src ? [s.src] : [];
}

// What to play for ONE win: { kind: "file", src } | { kind: "chime" } | null (silent).
// "mix" avoids repeating the previous pick so consecutive wins sound different.
export function resolveCelebration(choice, { rand = Math.random, previous = "" } = {}) {
  if (choice === "none") return null;
  if (choice === "mix") {
    const pool = MIX_POOL.length > 1 ? MIX_POOL.filter((s) => s.src !== previous) : MIX_POOL;
    return { kind: "file", src: pool[Math.floor(rand() * pool.length) % pool.length].src };
  }
  const s = CELEBRATION_SOUNDS.find((o) => o.value === choice);
  if (s?.src) return { kind: "file", src: s.src };
  if (choice === "chime") return { kind: "chime" };
  return resolveCelebration(DEFAULT_CELEBRATION);
}
