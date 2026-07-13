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

import SceneVoicePicker from "./SceneVoicePicker.vue";

const CATALOG = {
  providers: {
    gemini: { available: true, defaultModel: "gemini-2.5-pro-preview-tts", voices: ["Kore", "Puck"] },
    openai: { available: false, defaultModel: "gpt-4o-mini-tts", voices: ["alloy", "marin"] },
  },
};

const TURNS = [
  { speaker: "Rabiya", text: "Assalamu Alaikum. First line.", lang: "ur" },
  { speaker: "Ibrahim", text: "Wa Alaikum Assalam.", lang: "ur" },
  { speaker: "Rabiya", text: "Second Rabiya line.", lang: "ur" },
];

async function mountPicker(turns = TURNS) {
  getTtsVoiceCatalog.mockResolvedValue(CATALOG);
  const wrapper = mount(SceneVoicePicker, { props: { turns, contentKind: "dialogue" } });
  await flushPromises();
  return wrapper;
}

describe("SceneVoicePicker", () => {
  beforeEach(() => {
    playAudio.mockClear(); stop.mockClear();
    getTtsVoiceCatalog.mockReset(); synthesizeSpeech.mockReset();
  });

  it("lists one row per distinct speaker, in first-appearance order", async () => {
    const wrapper = await mountPicker();
    const names = wrapper.findAll(".sp-name").map((n) => n.text());
    expect(names).toEqual(["Rabiya", "Ibrahim"]); // deduped, not one per turn
  });

  it("defaults each speaker to a different voice (round-robin)", async () => {
    const wrapper = await mountPicker();
    const selects = wrapper.findAll(".sp-row select");
    expect(selects[0].element.value).toBe("gemini|gemini-2.5-pro-preview-tts|Kore");
    expect(selects[1].element.value).toBe("gemini|gemini-2.5-pro-preview-tts|Puck");
  });

  it("Preview uses the speaker's FIRST line's first sentence", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/preview.wav" });
    const wrapper = await mountPicker();
    await wrapper.findAll(".sp-preview")[0].trigger("click"); // Rabiya's preview
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      text: "Assalamu Alaikum.", lang: "ur", voiceName: "Kore",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "dialogue",
    });
    expect(playAudio).toHaveBeenCalledWith("https://cdn/preview.wav", expect.any(Object));
  });

  it("replaying the same speaker's preview does not re-synthesize", async () => {
    synthesizeSpeech.mockResolvedValue({ configured: true, url: "https://cdn/preview.wav" });
    const wrapper = await mountPicker();
    await wrapper.findAll(".sp-preview")[0].trigger("click");
    await flushPromises();
    await wrapper.findAll(".sp-preview")[0].trigger("click");
    await flushPromises();
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(playAudio).toHaveBeenCalledTimes(2);
  });

  it("Generate & save whole scene synthesizes every line with its speaker's voice, and emits one accept with all clips", async () => {
    synthesizeSpeech
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/1.wav" })
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/2.wav" })
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/3.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".sp-generate").trigger("click");
    await flushPromises();

    expect(synthesizeSpeech).toHaveBeenCalledTimes(3);
    expect(synthesizeSpeech).toHaveBeenNthCalledWith(1, {
      text: "Assalamu Alaikum. First line.", lang: "ur", voiceName: "Kore",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "dialogue",
    });
    expect(synthesizeSpeech).toHaveBeenNthCalledWith(2, {
      text: "Wa Alaikum Assalam.", lang: "ur", voiceName: "Puck",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "dialogue",
    });
    expect(synthesizeSpeech).toHaveBeenNthCalledWith(3, {
      text: "Second Rabiya line.", lang: "ur", voiceName: "Kore", // same voice as Rabiya's first line
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", contentKind: "dialogue",
    });

    const accepted = wrapper.emitted("accept")[0][0];
    expect(accepted).toHaveLength(3);
    expect(accepted[0]).toEqual({
      text: "Assalamu Alaikum. First line.", lang: "ur",
      provider: "gemini", model: "gemini-2.5-pro-preview-tts", voiceName: "Kore", url: "https://cdn/1.wav",
    });
    expect(wrapper.find(".vp-ok").text()).toContain("3");
  });

  it("one line failing doesn't stop the rest — surfaces a partial-failure message and still saves what worked", async () => {
    synthesizeSpeech
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/1.wav" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ configured: true, url: "https://cdn/3.wav" });
    const wrapper = await mountPicker();
    await wrapper.find(".sp-generate").trigger("click");
    await flushPromises();

    const accepted = wrapper.emitted("accept")[0][0];
    expect(accepted).toHaveLength(2); // the failed one is skipped
    expect(wrapper.find(".vp-err").text()).toContain("1 line");
  });
});
