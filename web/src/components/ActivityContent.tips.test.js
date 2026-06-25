import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

// Verifies the parent-facing "tips" kind: beautiful Urdu (Nastaliq) typography
// plus audio at both line and whole-section granularity. We mock useSpeech so we
// can assert the audio wiring (jsdom has no real SpeechSynthesis).
const speak = vi.fn();
const speakSequence = vi.fn();
const speakingId = ref(null);

vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true),
    speakingId,
    loadingId: ref(null),
    sequenceIndex: ref(-1),
    ttsLogs: ref([]),
    speak,
    speakSequence,
    playAudio: vi.fn(),
    stop: vi.fn(),
  }),
}));

import ActivityContent from "./ActivityContent.vue";

const TIPS_CONTENT = {
  kind: "tips",
  primaryLang: "ur",
  tips: {
    tips: ["پہلا مشورہ", "دوسرا مشورہ"],
    watchFor: ["خیال رکھیں"],
    encourage: ["ماشاء اللہ", "بہت خوب"],
  },
};

function mountTips() {
  return mount(ActivityContent, { props: { content: TIPS_CONTENT } });
}

describe("ActivityContent — tips (audio + Nastaliq)", () => {
  beforeEach(() => {
    speak.mockClear();
    speakSequence.mockClear();
    speakingId.value = null;
  });

  it("renders all three sections in order", () => {
    const wrapper = mountTips();
    const heads = wrapper.findAll(".tips-block .sub-h").map((h) => h.text());
    expect(heads).toEqual(["💡 Tips", "👀 Watch for", "🌟 Encourage"]);
  });

  it("applies the Nastaliq Urdu font and RTL to every tip list", () => {
    const wrapper = mountTips();
    const lists = wrapper.findAll(".tips-list");
    expect(lists.length).toBe(3);
    for (const ul of lists) {
      expect(ul.classes()).toContain("font-urdu");
      expect(ul.classes()).toContain("rtl");
    }
  });

  it("gives every line its own speaker button + readable text", () => {
    const wrapper = mountTips();
    const lines = wrapper.findAll(".tip-line");
    // 2 tips + 1 watchFor + 2 encourage = 5 lines, each with a SpeakButton.
    expect(lines.length).toBe(5);
    for (const li of lines) {
      expect(li.find(".tip-speak").exists()).toBe(true);
      expect(li.find(".tip-text").text().length).toBeGreaterThan(0);
    }
  });

  it("speaks the single line (in Urdu) when its line button is tapped", async () => {
    const wrapper = mountTips();
    await wrapper.findAll(".tip-line .tip-speak")[0].trigger("click");
    expect(speak).toHaveBeenCalledWith("پہلا مشورہ", "ur", expect.any(Object));
  });

  it("plays the whole section as an ordered Urdu sequence when its button is clicked", async () => {
    const wrapper = mountTips();
    await wrapper.findAll(".section-play")[0].trigger("click");
    expect(speakSequence).toHaveBeenCalledTimes(1);
    const turns = speakSequence.mock.calls[0][0];
    expect(turns.map((t) => t.text)).toEqual(["پہلا مشورہ", "دوسرا مشورہ"]);
    expect(turns.every((t) => t.lang === "ur")).toBe(true);
  });

  it("highlights the line whose id is currently speaking", async () => {
    const wrapper = mountTips();
    speakingId.value = "ur::خیال رکھیں";
    await wrapper.vm.$nextTick();
    const speaking = wrapper.findAll(".tip-line.speaking");
    expect(speaking.length).toBe(1);
    expect(speaking[0].find(".tip-text").text()).toBe("خیال رکھیں");
  });

  it("renders an embedded ready-to-use story + discussion questions, no blank story when absent", async () => {
    const withStory = {
      kind: "tips",
      primaryLang: "ur",
      tips: {
        lang: "ur",
        story: { title: "ابو بکرؓ کی کہانی", paragraphs: ["پہلا حصہ۔", "دوسرا حصہ۔"], moral: "ہمدردی سیکھیں۔" },
        discussionQuestions: ["بچے نے کیا محسوس کیا؟"],
        tips: ["آہستہ پڑھیں"],
      },
    };
    const wrapper = mount(ActivityContent, { props: { content: withStory } });
    const story = wrapper.find(".tips-story");
    expect(story.exists()).toBe(true);
    expect(story.find(".story-title").text()).toBe("ابو بکرؓ کی کہانی");
    expect(story.findAll(".para-body").length).toBe(2);
    expect(story.find(".tips-moral").text()).toContain("ہمدردی");
    // The discussion block renders with its own heading.
    const heads = wrapper.findAll(".tips-block .sub-h").map((h) => h.text());
    expect(heads).toContain("💬 Talk about it");
    // The plain tips content (TIPS_CONTENT) carries no story → no story block.
    expect(mountTips().find(".tips-story").exists()).toBe(false);
  });

  it("reads the moral aloud as part of the whole story when 'Read aloud' is tapped", async () => {
    const withStory = {
      kind: "tips",
      primaryLang: "ur",
      tips: {
        lang: "ur",
        story: { title: "ابو بکرؓ کی کہانی", paragraphs: ["پہلا حصہ۔", "دوسرا حصہ۔"], moral: "ہمدردی سیکھیں۔" },
        tips: ["آہستہ پڑھیں"],
      },
    };
    const wrapper = mount(ActivityContent, { props: { content: withStory } });
    await wrapper.find(".tips-story .story-head .speak-btn").trigger("click");
    expect(speak).toHaveBeenCalledWith("پہلا حصہ۔ دوسرا حصہ۔ ہمدردی سیکھیں۔", "ur", expect.any(Object));
  });

  it("drops empty sections instead of rendering blank blocks", () => {
    const wrapper = mount(ActivityContent, {
      props: { content: { kind: "tips", primaryLang: "ur", tips: { tips: ["only this"], watchFor: [], encourage: [] } } },
    });
    expect(wrapper.findAll(".tips-block").length).toBe(1);
  });
});
