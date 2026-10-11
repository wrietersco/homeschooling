import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import civilizations from "@/lib/wikido/topics/civilizations.js";

vi.mock("@/composables/useSpeech", () => ({
  useSpeech: () => ({ stop: vi.fn(), speak: vi.fn(), speakingId: { value: null } }),
}));
vi.mock("@/components/VoicePicker.vue", () => ({
  default: { name: "VoicePicker", template: "<div />" },
}));
vi.mock("@/components/SpeakButton.vue", () => ({
  default: {
    name: "SpeakButton",
    props: ["text", "audioUrl"],
    template: "<button class='speak-stub' :data-audio='audioUrl'>listen</button>",
  },
}));

import WikidoInfoCard from "./WikidoInfoCard.vue";

const bullCapitals = civilizations.scenes["bull-capitals"];
const impost = bullCapitals.hotspots.find((h) => h.id === "impost");
const empires = civilizations.scenes["civilizations-overview"].hotspots.find((h) => h.id === "empires");

describe("WikidoInfoCard", () => {
  it("renders the info card content and fun fact", () => {
    const w = mount(WikidoInfoCard, { props: { spot: impost } });
    expect(w.find(".wd-info-title").text()).toBe("Double-Bull Impost");
    expect(w.text()).toContain("Fun fact!");
    expect(w.find(".wd-enter").exists()).toBe(false);
  });

  it("hands the recorded audio clip to the Listen button when the hotspot has one", () => {
    const w = mount(WikidoInfoCard, {
      props: { spot: { ...impost, audio: "/wikido/civilizations/audio/bull-capitals.impost.mp3" } },
    });
    expect(w.find(".speak-stub").attributes("data-audio")).toBe("/wikido/civilizations/audio/bull-capitals.impost.mp3");
  });

  it("leaves audioUrl empty for hotspots without a recording (runtime TTS fallback)", () => {
    const unrecorded = { ...impost, audio: undefined };
    const w = mount(WikidoInfoCard, { props: { spot: unrecorded } });
    expect(w.find(".speak-stub").attributes("data-audio")).toBe("");
  });

  it("shows the Step inside action for doorway hotspots with the double-tap hint", () => {
    const w = mount(WikidoInfoCard, { props: { spot: empires } });
    expect(w.find(".wd-enter").exists()).toBe(true);
    expect(w.find(".wd-hint").text()).toContain("double-tap");
  });
});
