import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const playAudio = vi.fn();
const stop = vi.fn();
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({ playAudio, stop }),
}));

const getTtsVoiceCatalog = vi.fn();
const synthesizeSpeech = vi.fn();
vi.mock("@/services/tts", () => ({
  getTtsVoiceCatalog: (...a) => getTtsVoiceCatalog(...a),
  synthesizeSpeech: (...a) => synthesizeSpeech(...a),
}));

import VoicePicker from "./VoicePicker.vue";

const CATALOG = {
  providers: {
    gemini: { available: true, defaultModel: "gemini-2.5-pro-preview-tts", voices: ["Kore", "Puck"] },
    openai: { available: false, defaultModel: "gpt-4o-mini-tts", voices: ["alloy", "marin"] },
  },
};

const PARAGRAPH = "This is the first sentence. This is a much longer second sentence that should never be sent to preview.";

async function mountPicker(props = {}) {
  getTtsVoiceCatalog.mockResolvedValue(CATALOG);
  const wrapper = mount(VoicePicker, { props: { text: PARAGRAPH, lang: "en", ...props } });
  await flushPromises();
  return wrapper;
}

describe("VoicePicker", () => {
  beforeEach(() => {
    playAudio.mockClear(); stop.mockClear();
    getTtsVoiceCatalog.mockReset(); synthesizeSpeech.mockReset();
  });

  it("lists only configured providers and flags unavailable ones", async () => {
    const wrapper = await mountPicker();
    const groups = wrapper.findAll("optgroup");
    expect(groups.length).toBe(1); // openai unavailable → no group
    expect(groups[0].attributes("label")).toBe("Gemini (finest)");
    expect(wrapper.findAll("optgroup option").length).toBe(2);
    expect(wrapper.find(".vp-hint").text()).toContain("OpenAI (4o)");
  });

  it("defaults the selection to the first available voice", async () => {
    const wrapper = await mountPicker();
    expect(wrapper.find("select").element.value).toBe("gemini|gemini-2.5-pro-preview-tts|Kore");
  });

  it("Preview sends only the first sentence, not the whole paragraph", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/preview.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-preview").trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      text: "This is the first sentence.", lang: "en", voiceName: "Kore",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "",
    });
    expect(playAudio).toHaveBeenCalledWith("https://cdn/preview.wav", expect.any(Object));
  });

  it("threads contentKind through to both preview and generate calls", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/clip.wav" });
    const wrapper = await mountPicker({ contentKind: "story" });
    await wrapper.find(".vp-preview").trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({ contentKind: "story" }));

    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenLastCalledWith(expect.objectContaining({ contentKind: "story", text: PARAGRAPH }));
  });

  it("replaying the same voice's preview does not re-synthesize", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/preview.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-preview").trigger("click");
    await flushPromises();
    await wrapper.find(".vp-preview").trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(playAudio).toHaveBeenCalledTimes(2);
  });

  it("Use this voice generates the FULL text without requiring a preview first", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    // No preview click at all — go straight to generate.
    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      text: PARAGRAPH, lang: "en", voiceName: "Kore",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "",
    });
    expect(playAudio).toHaveBeenCalledWith("https://cdn/full.wav", expect.any(Object));
    // Play / Discard / Save now shown alongside Preview / Regenerate.
    expect(wrapper.find(".vp-discard").exists()).toBe(true);
    expect(wrapper.find(".vp-generate").text()).toContain("Regenerate");
  });

  it("the voice dropdown stays enabled once a candidate is generated", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    expect(wrapper.find("select").attributes("disabled")).toBeUndefined();
  });

  it("Regenerate makes a fresh call for the same voice (a new take, not a replay)", async () => {
    synthesizeSpeech
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/take1.wav" })
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/take2.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click"); // Use this voice
    await flushPromises();
    await wrapper.find(".vp-generate").trigger("click"); // Regenerate
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(playAudio).toHaveBeenLastCalledWith("https://cdn/take2.wav", expect.any(Object));
  });

  it("switching voices after generating reverts to Use-this-voice for the new voice, without discarding", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    expect(wrapper.find(".vp-discard").exists()).toBe(true);

    await wrapper.find("select").setValue("gemini|gemini-2.5-pro-preview-tts|Puck");
    // No candidate for "Puck" yet ⇒ back to the picking row for the new voice.
    expect(wrapper.find(".vp-discard").exists()).toBe(false);
    expect(wrapper.find(".vp-generate").text()).toContain("Use this voice");
    expect(wrapper.emitted("accept")).toBeUndefined();
  });

  it("replaying the generated candidate does not re-synthesize", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    await wrapper.find(".vp-play").trigger("click");
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(playAudio).toHaveBeenCalledTimes(2);
  });

  it("Discard drops the candidate and returns to the picker without saving", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click");
    await flushPromises();
    await wrapper.find(".vp-discard").trigger("click");
    expect(wrapper.emitted("accept")).toBeUndefined();
    expect(wrapper.find(".vp-discard").exists()).toBe(false);
    expect(wrapper.find(".vp-generate").text()).toContain("Use this voice");
  });

  it("Save emits the generated clip (no re-synthesis) and nothing is emitted before Save", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/full.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".vp-generate").trigger("click"); // generate
    await flushPromises();
    expect(wrapper.emitted("accept")).toBeUndefined(); // not saved yet, just generated

    await wrapper.find(".vp-save").trigger("click");
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("accept")[0][0]).toEqual({
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Kore", url: "https://cdn/full.wav",
    });
  });
});
