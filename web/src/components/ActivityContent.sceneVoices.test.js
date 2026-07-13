import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

// "Play whole scene" (dialogue) and "Play section" (tips) must sound the same as
// tapping each line individually — a line with a saved custom voice should play
// that recording during batch playback too, not silently fall back to the
// default per-character/platform voice.
const speakSequence = vi.fn();
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true), speakingId: ref(null), loadingId: ref(null), sequenceIndex: ref(-1),
    ttsLogs: ref([]), lastError: ref(""), speak: vi.fn(), speakSequence, playAudio: vi.fn(), stop: vi.fn(),
  }),
}));

// Stub SceneVoicePicker with a button that emits a fixed multi-line accept
// payload, so we can assert ActivityContent's bulk-save plumbing without
// driving the real picker's async catalog + per-line synthesis loop.
vi.mock("@/components/SceneVoicePicker.vue", () => ({
  default: {
    name: "SceneVoicePicker",
    props: ["turns", "contentKind"],
    emits: ["accept", "close"],
    template: `<button class="stub-scene-accept" @click="$emit('accept', [
      { text: 'سلام', lang: 'ur', provider: 'gemini', model: 'gemini-2.5-pro-preview-tts', voiceName: 'Kore', url: 'https://cdn/scene-1.wav' },
      { text: 'وعلیکم السلام', lang: 'ur', provider: 'gemini', model: 'gemini-2.5-pro-preview-tts', voiceName: 'Puck', url: 'https://cdn/scene-2.wav' },
    ])">accept</button>`,
  },
}));

import ActivityContent from "./ActivityContent.vue";

describe("ActivityContent — whole-scene/section playback honors saved voices", () => {
  beforeEach(() => { speakSequence.mockClear(); });

  it("playScene passes each turn's saved override URL, falling back to '' when none is saved", async () => {
    const content = {
      kind: "dialogue",
      dialogue: {
        title: "My Room",
        lang: "ur",
        turns: [
          { speaker: "Rabiya", text: "سلام" },
          { speaker: "Ibrahim", text: "وعلیکم السلام" },
        ],
      },
    };
    const overrides = { "ur|سلام": { url: "https://cdn/rabiya-custom.wav", provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin" } };
    const wrapper = mount(ActivityContent, { props: { content, audioOverrides: overrides } });

    await wrapper.find(".scene-btn").trigger("click");

    expect(speakSequence).toHaveBeenCalledTimes(1);
    const turns = speakSequence.mock.calls[0][0];
    expect(turns).toHaveLength(2);
    expect(turns[0].audioUrl).toBe("https://cdn/rabiya-custom.wav"); // saved override
    expect(turns[1].audioUrl).toBe(""); // no saved voice for this line
    expect(turns[1].voiceName).toBeTruthy(); // still gets the default per-character voice
  });

  it("playSection (tips) passes each line's saved override URL the same way", async () => {
    const content = {
      kind: "tips",
      tips: { tips: ["پہلا مشورہ", "دوسرا مشورہ"] },
    };
    const overrides = { "ur|پہلا مشورہ": { url: "https://cdn/tip1-custom.wav" } };
    const wrapper = mount(ActivityContent, { props: { content, audioOverrides: overrides } });

    await wrapper.find(".section-play").trigger("click");

    expect(speakSequence).toHaveBeenCalledTimes(1);
    const turns = speakSequence.mock.calls[0][0];
    expect(turns.find((t) => t.text === "پہلا مشورہ").audioUrl).toBe("https://cdn/tip1-custom.wav");
    expect(turns.find((t) => t.text === "دوسرا مشورہ").audioUrl).toBe("");
  });
});

describe("ActivityContent — scene-wide voice picker (dialogue)", () => {
  const DIALOGUE_CONTENT = {
    kind: "dialogue",
    dialogue: {
      title: "My Room",
      lang: "ur",
      turns: [
        { speaker: "Rabiya", text: "سلام" },
        { speaker: "Ibrahim", text: "وعلیکم السلام" },
      ],
    },
  };

  it("hides the scene-voice caret unless canEditVoice is set", () => {
    const ro = mount(ActivityContent, { props: { content: DIALOGUE_CONTENT } });
    expect(ro.find(".scene-voice-btn").exists()).toBe(false);
    const rw = mount(ActivityContent, { props: { content: DIALOGUE_CONTENT, canEditVoice: true } });
    expect(rw.find(".scene-voice-btn").exists()).toBe(true);
  });

  it("opens the SceneVoicePicker with the dialogue's turns, and saves EVERY accepted line as an override", async () => {
    const wrapper = mount(ActivityContent, { props: { content: DIALOGUE_CONTENT, canEditVoice: true } });
    await wrapper.find(".scene-voice-btn").trigger("click");
    await wrapper.find(".stub-scene-accept").trigger("click");

    const events = wrapper.emitted("update:override");
    expect(events).toHaveLength(2); // one save per line in the scene, in one action
    expect(events[0][0]).toEqual({
      key: "ur|سلام", text: "سلام", lang: "ur",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Kore", url: "https://cdn/scene-1.wav",
    });
    expect(events[1][0]).toEqual({
      key: "ur|وعلیکم السلام", text: "وعلیکم السلام", lang: "ur",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Puck", url: "https://cdn/scene-2.wav",
    });
  });
});
