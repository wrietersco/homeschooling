import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

// Verifies the quran_reading kind splits a fused Bismillah + ayah 1 into its own
// centered line, separate from the ayah — the verified source (Uthmani mushaf
// convention) embeds it directly in ayah 1's Arabic text.
const speak = vi.fn();
vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({
    supported: ref(true),
    speakingId: ref(null),
    loadingId: ref(null),
    sequenceIndex: ref(-1),
    ttsLogs: ref([]),
    speak,
    speakSequence: vi.fn(),
    playAudio: vi.fn(),
    stop: vi.fn(),
  }),
}));

import ActivityContent from "./ActivityContent.vue";

function ikhlasWords() {
  return ["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ", "قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"].map((arabic) => ({ arabic, transliteration: "" }));
}

const QURAN_CONTENT = {
  kind: "quran_reading",
  primaryLang: "ar",
  quran: {
    surahName: "Al-Ikhlas & An-Nas",
    verses: [
      {
        surah: 112, ayah: 1,
        arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ قُلْ هُوَ اللَّهُ أَحَدٌ",
        transliteration: "Qul huwal laahu ahad",
        translation: "Say, He is Allah, [who is] One,",
        words: ikhlasWords(),
        audioUrl: "https://everyayah.com/data/112001.mp3",
      },
      {
        surah: 112, ayah: 2,
        arabic: "اللَّهُ الصَّمَدُ",
        transliteration: "Allah hus-samad",
        translation: "Allah, the Eternal Refuge.",
        words: [{ arabic: "اللَّهُ" }, { arabic: "الصَّمَدُ" }],
      },
    ],
  },
};

function mountQuran(content = QURAN_CONTENT) {
  return mount(ActivityContent, { props: { content } });
}

describe("ActivityContent — quran_reading (Bismillah split)", () => {
  beforeEach(() => { speak.mockClear(); });

  it("renders the Bismillah as its own centered line, not fused into ayah 1", () => {
    const wrapper = mountQuran();
    const bismillahLine = wrapper.find(".bismillah-line");
    expect(bismillahLine.exists()).toBe(true);
    expect(bismillahLine.find(".bismillah-arabic").text()).toBe("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
  });

  it("ayah 1's own text/words no longer include the Bismillah", () => {
    const wrapper = mountQuran();
    const ayahs = wrapper.findAll(".ayah");
    const firstAyahText = ayahs[0].find(".ayah-arabic").text();
    expect(firstAyahText).not.toContain("بِسْمِ");
    expect(ayahs[0].findAll(".ayah-word")).toHaveLength(4); // only the real ayah's 4 words
  });

  it("ayah 1's translation/transliteration are untouched (they never included the Bismillah)", () => {
    const wrapper = mountQuran();
    const ayahs = wrapper.findAll(".ayah");
    expect(ayahs[0].find(".ayah-translit").text()).toBe("Qul huwal laahu ahad");
    expect(ayahs[0].find(".ayah-translation").text()).toBe("Say, He is Allah, [who is] One,");
  });

  it("only renders one Bismillah line even with two ayahs from the same surah", () => {
    const wrapper = mountQuran();
    expect(wrapper.findAll(".bismillah-line")).toHaveLength(1);
  });

  it("does not split a 4-word ayah that IS just the Bismillah (Al-Fatihah's real ayah 1)", () => {
    const content = {
      kind: "quran_reading",
      quran: {
        verses: [{
          surah: 1, ayah: 1,
          arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
          words: [{ arabic: "بِسْمِ" }, { arabic: "اللَّهِ" }, { arabic: "الرَّحْمَٰنِ" }, { arabic: "الرَّحِيمِ" }],
        }],
      },
    };
    const wrapper = mountQuran(content);
    expect(wrapper.find(".bismillah-line").exists()).toBe(false);
    // All four Bismillah words stay in the single ayah — none peeled off.
    expect(wrapper.findAll(".ayah-word").map((w) => w.find(".aw-ar").text())).toEqual([
      "بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ",
    ]);
  });
});
