import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

// Verifies per-element saved-voice behaviour on the Qaida renderer:
//  - a glyph with a saved override plays that URL (not the library/TTS path)
//  - the voice caret shows only when canEditVoice, and an accepted voice bubbles up
//    as `update:override` with the right key + payload.
const speak = vi.fn();
const playAudio = vi.fn();
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true), speakingId: ref(null), loadingId: ref(null), sequenceIndex: ref(-1),
    ttsLogs: ref([]), lastError: ref(""), speak, speakSequence: vi.fn(), playAudio, stop: vi.fn(),
  }),
}));

vi.mock("@/composables/useQaidaLibrary", () => ({
  useQaidaLibrary: () => ({
    liveByGlyph: ref(new Map()),
    liveAudioUrl: (it) => it?.audioUrl ?? null,
    liveSpellScript: (it) => it?.spellScript || "",
  }),
}));

// Stub VoicePicker with a button that emits a fixed accept payload, so we can assert
// ActivityContent's save plumbing without driving the real picker's async catalog.
vi.mock("@/components/VoicePicker.vue", () => ({
  default: {
    name: "VoicePicker",
    props: ["text", "lang"],
    emits: ["accept", "close"],
    template: `<button class="stub-accept" @click="$emit('accept', { provider: 'openai', model: 'gpt-4o-mini-tts', voiceName: 'marin', url: 'https://cdn/marin.wav' })">accept</button>`,
  },
}));

import ActivityContent from "./ActivityContent.vue";

const CONTENT = {
  kind: "qaida_exercise",
  primaryLang: "ar",
  exercises: [{ title: "Zabar", instruction: "Tap.", lang: "ar", items: [
    { text: "بَ", transliteration: "Ba", audioUrl: "https://cdn/lib-ba.wav" },
  ] }],
};

describe("ActivityContent — saved per-element voices", () => {
  beforeEach(() => { speak.mockClear(); playAudio.mockClear(); });

  it("plays the saved override URL instead of the library recording", async () => {
    const overrides = { "ar|بَ": { url: "https://cdn/saved-ba.wav", provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin" } };
    const wrapper = mount(ActivityContent, { props: { content: CONTENT, audioOverrides: overrides } });
    await wrapper.find(".glyph").trigger("click");
    expect(playAudio).toHaveBeenCalledTimes(1);
    expect(playAudio.mock.calls[0][0]).toBe("https://cdn/saved-ba.wav"); // override wins over lib-ba.wav
    expect(speak).not.toHaveBeenCalled();
    // The glyph is flagged as personalized (mic icon + accent class).
    expect(wrapper.find(".glyph").classes()).toContain("glyph-saved");
    expect(wrapper.find(".glyph-ico").text()).toBe("🎙️");
  });

  it("hides the voice caret unless canEditVoice is set", () => {
    const ro = mount(ActivityContent, { props: { content: CONTENT } });
    expect(ro.find(".glyph-voice").exists()).toBe(false);
    const rw = mount(ActivityContent, { props: { content: CONTENT, canEditVoice: true } });
    expect(rw.find(".glyph-voice").exists()).toBe(true);
  });

  it("emits update:override with the right key + payload when a voice is accepted", async () => {
    const wrapper = mount(ActivityContent, { props: { content: CONTENT, canEditVoice: true } });
    await wrapper.find(".glyph-voice").trigger("click"); // open the (stubbed) picker
    await wrapper.find(".stub-accept").trigger("click");  // accept a voice
    const ev = wrapper.emitted("update:override");
    expect(ev).toHaveLength(1);
    expect(ev[0][0]).toEqual({
      key: "ar|بَ", text: "بَ", lang: "ar",
      provider: "openai", model: "gpt-4o-mini-tts", voiceName: "marin", url: "https://cdn/marin.wav",
    });
  });
});
