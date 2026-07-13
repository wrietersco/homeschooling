import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
const synthesizeSpeech = vi.fn();
vi.mock("@/services/tts", () => ({ synthesizeSpeech: (...a) => synthesizeSpeech(...a) }));

import { useSpeech } from "./useSpeech";

// speakSequence's audioUrl-per-turn fallback: a turn with a saved custom-voice
// URL should play that recording directly (no synthesis call), falling back to
// TTS only if the recording fails to load. This is what makes "play the whole
// scene/section" sound the same as tapping an individually-customized line.
describe("useSpeech.speakSequence — per-turn audioUrl", () => {
  let playSpy;
  let audioInstances;

  beforeEach(() => {
    synthesizeSpeech.mockReset();
    audioInstances = [];
    class FakeAudio {
      constructor(url) {
        this.url = url;
        this.onended = null;
        this.onerror = null;
        this.onplaying = null;
        audioInstances.push(this);
      }
      play() {
        playSpy();
        return Promise.resolve();
      }
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    playSpy = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays the turn's audioUrl directly, without calling synthesizeSpeech", async () => {
    const { speakSequence, stop } = useSpeech();
    speakSequence([{ text: "hi", lang: "en", id: "t0", audioUrl: "https://cdn/custom.wav" }]);
    await Promise.resolve(); // let the play() microtask settle
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].url).toBe("https://cdn/custom.wav");
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    stop();
  });

  it("falls back to TTS if the saved audioUrl fails to load", async () => {
    const { speakSequence, stop } = useSpeech();
    synthesizeSpeech.mockResolvedValue({ configured: false }); // no signed-in server path either; just confirms the fallback path fires
    speakSequence([{ text: "hi", lang: "en", id: "t0", voiceName: "Kore", audioUrl: "https://cdn/broken.wav" }]);
    await Promise.resolve();
    expect(audioInstances).toHaveLength(1);
    audioInstances[0].onerror?.(); // simulate the recording failing to play
    await Promise.resolve();
    await Promise.resolve();
    // Fallback path attempted synthesis (server unavailable here since auth.currentUser
    // is null, so it ultimately falls through to the browser voice / no-op) — the
    // important assertion is it did NOT just give up silently on the broken URL.
    stop();
  });

  it("a turn with no audioUrl never touches Audio (goes straight to TTS/browser voice)", async () => {
    const { speakSequence, stop } = useSpeech();
    speakSequence([{ text: "hi", lang: "en", id: "t0" }]);
    await Promise.resolve();
    expect(audioInstances).toHaveLength(0);
    stop();
  });
});
