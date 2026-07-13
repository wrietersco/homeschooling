import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

// Verifies the qaida_exercise renderer's library wiring: a glyph LINKED to the
// shared nooraniQaida library (carries audioUrl + spellScript) plays the curated
// recording via playAudio and shows the spell script; an unlinked glyph falls
// back to TTS via speak. We mock useSpeech to assert which path fires.
const speak = vi.fn();
const playAudio = vi.fn();

vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true),
    speakingId: ref(null),
    loadingId: ref(null),
    sequenceIndex: ref(-1),
    ttsLogs: ref([]),
    lastError: ref(""),
    speak,
    speakSequence: vi.fn(),
    playAudio,
    stop: vi.fn(),
  }),
}));

// Mock the live library resolver: by default it passes through to the embedded
// snapshot; `liveOverride[glyph]` simulates the platform having voiced that glyph
// since the content was generated (the auto-upgrade-over-time behaviour).
let liveOverride = {};
vi.mock("@/composables/useQaidaLibrary", () => ({
  useQaidaLibrary: () => ({
    liveByGlyph: ref(new Map()),
    liveAudioUrl: (it) => liveOverride[it?.materialRef?.glyph] ?? it?.audioUrl ?? null,
    liveSpellScript: (it) => it?.spellScript || "",
  }),
}));

import ActivityContent from "./ActivityContent.vue";

// One linked item (library audio + script) and one unlinked (TTS-only).
const QAIDA_CONTENT = {
  kind: "qaida_exercise",
  primaryLang: "ar",
  exercises: [
    {
      title: "Letters with Zabar",
      instruction: "Tap each to hear it.",
      lang: "ar",
      items: [
        { text: "بَ", transliteration: "Ba", spellScript: "Bay Zabar Ba", audioUrl: "https://cdn/ba.wav" },
        { text: "ﷺ", transliteration: "" },
      ],
    },
  ],
};

function mountQaida() {
  return mount(ActivityContent, { props: { content: QAIDA_CONTENT } });
}

describe("ActivityContent — qaida_exercise (shared-library wiring)", () => {
  beforeEach(() => {
    speak.mockClear();
    playAudio.mockClear();
    liveOverride = {};
  });

  it("renders one glyph button per drill item", () => {
    const wrapper = mountQaida();
    expect(wrapper.findAll(".glyph").length).toBe(2);
  });

  it("marks the library-linked glyph with the .glyph-lib accent + headphone icon", () => {
    const wrapper = mountQaida();
    const glyphs = wrapper.findAll(".glyph");
    expect(glyphs[0].classes()).toContain("glyph-lib");
    expect(glyphs[0].find(".glyph-ico").text()).toBe("🎧");
    // The unlinked glyph stays plain TTS.
    expect(glyphs[1].classes()).not.toContain("glyph-lib");
    expect(glyphs[1].find(".glyph-ico").text()).toBe("🔊");
  });

  it("shows the spell-out script only on the linked glyph", () => {
    const wrapper = mountQaida();
    const glyphs = wrapper.findAll(".glyph");
    expect(glyphs[0].find(".glyph-spell").text()).toBe("Bay Zabar Ba");
    expect(glyphs[1].find(".glyph-spell").exists()).toBe(false);
  });

  it("plays the curated recording (not TTS) when a linked glyph is tapped", async () => {
    const wrapper = mountQaida();
    await wrapper.findAll(".glyph")[0].trigger("click");
    expect(playAudio).toHaveBeenCalledTimes(1);
    expect(playAudio.mock.calls[0][0]).toBe("https://cdn/ba.wav");
    expect(speak).not.toHaveBeenCalled();
  });

  it("falls back to TTS when an unlinked glyph is tapped", async () => {
    const wrapper = mountQaida();
    await wrapper.findAll(".glyph")[1].trigger("click");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe("ﷺ");
    expect(playAudio).not.toHaveBeenCalled();
  });

  it("auto-upgrades: a glyph with no embedded audio plays the live library recording once voiced", async () => {
    // The activity was generated before this glyph had audio (no embedded audioUrl),
    // but it carries a materialRef. The platform has since voiced it, so the live
    // resolver returns a URL — the glyph must play it with NO regeneration.
    const content = {
      kind: "qaida_exercise",
      primaryLang: "ar",
      exercises: [{ lang: "ar", items: [
        { text: "تِ", transliteration: "Ti", spellScript: "Tay Zer Ti",
          materialRef: { collection: "nooraniQaida", lessonId: "l1", glyph: "تِ" } },
      ] }],
    };
    liveOverride = { "تِ": "https://cdn/live-ti.wav" };
    const wrapper = mount(ActivityContent, { props: { content } });
    const glyph = wrapper.findAll(".glyph")[0];
    expect(glyph.classes()).toContain("glyph-lib");
    expect(glyph.find(".glyph-ico").text()).toBe("🎧");
    await glyph.trigger("click");
    expect(playAudio).toHaveBeenCalledTimes(1);
    expect(playAudio.mock.calls[0][0]).toBe("https://cdn/live-ti.wav");
    expect(speak).not.toHaveBeenCalled();
  });
});
