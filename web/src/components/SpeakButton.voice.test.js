import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { TTS_OVERRIDES } from "@/lib/ttsOverrides";

const speak = vi.fn();
const playAudio = vi.fn();
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true), speakingId: ref(null), loadingId: ref(null),
    speak, playAudio, stop: vi.fn(),
  }),
}));

// Stub the picker so importing SpeakButton doesn't pull in the live catalog service.
vi.mock("@/components/VoicePicker.vue", () => ({
  default: { name: "VoicePicker", props: ["text", "lang"], template: "<div class='vp-stub' />" },
}));

import SpeakButton from "./SpeakButton.vue";

function withContext({ override = null, canEditVoice = false, save = vi.fn() } = {}) {
  return {
    overrideFor: () => override,
    get canEditVoice() { return canEditVoice; },
    saveOverride: save,
  };
}

describe("SpeakButton — saved-voice context", () => {
  beforeEach(() => { speak.mockClear(); playAudio.mockClear(); });

  it("plays a saved override URL instead of the default TTS path", async () => {
    const ctx = withContext({ override: { url: "https://cdn/saved.wav", voiceName: "marin" } });
    const wrapper = mount(SpeakButton, {
      props: { text: "hello", lang: "en" },
      global: { provide: { [TTS_OVERRIDES]: ctx } },
    });
    await wrapper.find(".speak-btn").trigger("click");
    expect(playAudio).toHaveBeenCalledWith("https://cdn/saved.wav", expect.any(Object));
    expect(speak).not.toHaveBeenCalled();
    expect(wrapper.find(".speak-btn").classes()).toContain("saved");
  });

  it("shows the voice caret only when canEditVoice is true", () => {
    const off = mount(SpeakButton, { props: { text: "hi" }, global: { provide: { [TTS_OVERRIDES]: withContext() } } });
    expect(off.find(".voice-caret").exists()).toBe(false);
    const on = mount(SpeakButton, { props: { text: "hi" }, global: { provide: { [TTS_OVERRIDES]: withContext({ canEditVoice: true }) } } });
    expect(on.find(".voice-caret").exists()).toBe(true);
  });

  it("without any override context, behaves as a plain speaker (no caret, default TTS)", async () => {
    const wrapper = mount(SpeakButton, { props: { text: "hello", lang: "en" } });
    expect(wrapper.find(".voice-caret").exists()).toBe(false);
    await wrapper.find(".speak-btn").trigger("click");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(playAudio).not.toHaveBeenCalled();
  });

  it("opens the picker when the caret is clicked", async () => {
    const wrapper = mount(SpeakButton, {
      props: { text: "hi" },
      global: { provide: { [TTS_OVERRIDES]: withContext({ canEditVoice: true }) } },
    });
    expect(wrapper.find(".vp-stub").exists()).toBe(false);
    await wrapper.find(".voice-caret").trigger("click");
    expect(wrapper.find(".vp-stub").exists()).toBe(true);
  });
});
