import { describe, it, expect } from "vitest";
import {
  downsample, floatToPcm16, pcm16ToFloat, bytesToBase64, base64ToBytes,
  micChunkToBase64, base64ToFloat, rms, appendTranscript,
  CELEBRATION_NOTES, CELEBRATION_CHIME_SECONDS, playCelebrationChime, looksLikeCelebration,
} from "./liveAudio";

describe("liveAudio", () => {
  it("downsamples 48k → 16k to a third of the length", () => {
    const out = downsample(new Float32Array(4800).fill(0.5), 48000, 16000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.5);
  });

  it("leaves audio alone when already at/below target rate", () => {
    const a = new Float32Array([0.1, 0.2]);
    expect(downsample(a, 16000, 16000)).toBe(a);
  });

  it("PCM16 conversion round-trips and clamps", () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 32767, -32768]);
    const back = pcm16ToFloat(new Int16Array([0, 32767, -32768]));
    expect(back[1]).toBeCloseTo(1);
    expect(back[2]).toBeCloseTo(-1);
  });

  it("base64 round-trips bytes, including large buffers", () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("mic chunk → base64 → float keeps the signal shape at 16k", () => {
    const mic = new Float32Array(480).map((_, i) => Math.sin(i / 10) * 0.5);
    const b64 = micChunkToBase64(mic, 48000); // → 160 samples
    expect(base64ToFloat(b64).length).toBe(160);
  });

  it("rms measures loudness", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it("appendTranscript merges same-speaker fragments and splits on speaker change", () => {
    let t = [];
    t = appendTranscript(t, "child", "hel");
    t = appendTranscript(t, "child", "lo");
    t = appendTranscript(t, "guide", "Hi!");
    t = appendTranscript(t, "guide", "");
    expect(t).toEqual([{ role: "child", text: "hello" }, { role: "guide", text: "Hi!" }]);
  });

  it("the celebration chime is a short ascending run that starts silent and ends within ~0.7s", () => {
    expect(CELEBRATION_NOTES.length).toBeGreaterThanOrEqual(3);
    const freqs = CELEBRATION_NOTES.map((n) => n.freq);
    expect(freqs).toEqual([...freqs].sort((a, b) => a - b)); // strictly ascending → a happy run, not random notes
    for (const n of CELEBRATION_NOTES) {
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start + n.dur).toBeLessThanOrEqual(0.7);
    }
  });

  it("playCelebrationChime schedules one oscillator+gain per note and is a no-op without a context", () => {
    expect(() => playCelebrationChime(null)).not.toThrow();
    const created = [];
    const ctx = {
      currentTime: 10,
      createOscillator: () => {
        const o = { connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } };
        created.push({ kind: "osc", node: o });
        return o;
      },
      createGain: () => {
        const g = { connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } };
        created.push({ kind: "gain", node: g });
        return g;
      },
      destination: {},
    };
    playCelebrationChime(ctx);
    expect(created.filter((c) => c.kind === "osc").length).toBe(CELEBRATION_NOTES.length);
    expect(created.filter((c) => c.kind === "gain").length).toBe(CELEBRATION_NOTES.length);
  });

  it("playCelebrationChime can be queued behind the buddy's voice", () => {
    const starts = [];
    const ctx = {
      currentTime: 10,
      createOscillator: () => ({ connect: () => {}, start: (t) => starts.push(t), stop: () => {}, frequency: {} }),
      createGain: () => ({ connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }),
      destination: {},
    };
    playCelebrationChime(ctx, 12);
    expect(starts[0]).toBe(12);
    playCelebrationChime(ctx, 3); // a time already past plays now, not in the past
    expect(starts[CELEBRATION_NOTES.length]).toBe(10);
    expect(CELEBRATION_CHIME_SECONDS).toBeGreaterThan(0.7);
  });

  it("looksLikeCelebration catches real praise the buddy says on a genuine win", () => {
    // Verbatim from a real transcript where the model praised correctly but
    // never called the `celebrate` tool — this is the safety net for that gap.
    expect(looksLikeCelebration("Wow, you did that perfectly! You nailed both parts, Abdul Hadi!")).toBe(true);
    expect(looksLikeCelebration("That is exactly right, Abdul Hadi! You spelled parents completely right,")).toBe(true);
    expect(looksLikeCelebration("Well done! Great job on that one.")).toBe(true);
    expect(looksLikeCelebration("You got it! 100% correct.")).toBe(true);
  });

  it("looksLikeCelebration ignores ordinary chat and corrections", () => {
    expect(looksLikeCelebration("Hello Abdul Hadi, what would you like to explore today?")).toBe(false);
    expect(looksLikeCelebration("Let's spell out all the letters together: P-A-R-E-N-T-S.")).toBe(false);
    expect(looksLikeCelebration("")).toBe(false);
    expect(looksLikeCelebration(undefined)).toBe(false);
    // Corrections must never be mistaken for praise.
    expect(looksLikeCelebration("That's not quite right, try again.")).toBe(false);
    expect(looksLikeCelebration("Hmm, that isn't correct — let's try once more.")).toBe(false);
    expect(looksLikeCelebration("You're not right yet, but you're close!")).toBe(false);
  });
});
