import { describe, it, expect, vi, beforeAll } from "vitest";

// Mobile browsers block <audio>.play() and speechSynthesis until a user gesture
// "unlocks" the page — and tapped words always play AFTER an async TTS
// round-trip (outside the gesture), so the unlock prime is what makes
// tap-to-hear work on phones. These tests verify the module primes both audio
// systems on the first gesture, before any tap handler would run, and only once.

const playCalls = [];
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.preload = "";
  }
  play() {
    playCalls.push(this.src);
    return Promise.resolve();
  }
}
vi.stubGlobal("Audio", FakeAudio);

const spoken = [];
vi.stubGlobal("SpeechSynthesisUtterance", class {
  constructor(text) { this.text = text; }
});
vi.stubGlobal("speechSynthesis", { getVoices: () => [], cancel: () => {}, speak: (u) => spoken.push(u.text) });

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/services/tts", () => ({ synthesizeSpeech: vi.fn() }));

// The listeners are installed at module import time — stub globals first, then
// import. (Dynamic import keeps the ordering explicit.)
let isSpeechAudioUnlocked;
let useSpeech;
beforeAll(async () => {
  const mod = await import("./useSpeech.js");
  isSpeechAudioUnlocked = mod.isSpeechAudioUnlocked;
  useSpeech = mod.useSpeech;
});

describe("useSpeech mobile audio unlock", () => {
  it("starts locked before any user gesture", () => {
    expect(isSpeechAudioUnlocked()).toBe(false);
  });

  it("the first gesture primes audio synchronously: silent element played + silent utterance spoken", () => {
    window.dispatchEvent(new Event("pointerdown"));
    expect(isSpeechAudioUnlocked()).toBe(true);
    expect(playCalls.length).toBe(1);
    expect(playCalls[0]).toMatch(/^data:audio\/wav/);
    expect(spoken).toContain(" ");
  });

  it("later gestures do not replay the unlock", () => {
    window.dispatchEvent(new Event("touchstart"));
    window.dispatchEvent(new Event("click"));
    expect(playCalls.length).toBe(1);
  });

  it("speak() primes defensively too (idempotent), so a tap always unlocks even if the global listener missed", async () => {
    // Fresh module instance with its own state: no gesture yet, then a speak().
    vi.resetModules();
    playCalls.length = 0;
    spoken.length = 0;
    vi.doMock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
    vi.doMock("@/services/tts", () => ({ synthesizeSpeech: vi.fn() }));
    const mod = await import("./useSpeech.js");
    expect(mod.isSpeechAudioUnlocked()).toBe(false);
    const { speak } = mod.useSpeech();
    speak("hello", "en");
    expect(mod.isSpeechAudioUnlocked()).toBe(true);
    expect(playCalls.length).toBe(1);
    expect(playCalls[0]).toMatch(/^data:audio\/wav/);
    expect(spoken).toContain(" ");
  });
});
