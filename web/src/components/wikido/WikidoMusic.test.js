import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { useSpeech } from "@/composables/useSpeech";
import { wikidoMusicTracks, shuffledTracks } from "@/lib/wikido/music";
import WikidoMusic from "./WikidoMusic.vue";

vi.mock("@/composables/useSpeech", async () => {
  const { ref } = await import("vue");
  const speakingId = ref(null), loadingId = ref(null);
  return { useSpeech: () => ({ speakingId, loadingId }) };
});

const { speakingId, loadingId } = useSpeech();
let instances, wrapper, hidden, rejectFirstPlay;

class TestAudio extends EventTarget {
  constructor() {
    super();
    this.volume = 1;
    this.currentTime = 0;
    this.src = "";
    this.play = vi.fn(async () => {
      if (rejectFirstPlay) {
        rejectFirstPlay = false;
        throw new DOMException("Gesture required", "NotAllowedError");
      }
    });
    this.pause = vi.fn();
    this.load = vi.fn();
    instances.push(this);
  }
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

async function open() {
  wrapper = mount(WikidoMusic, { attachTo: document.body });
  await flushPromises();
  vi.advanceTimersByTime(1000);
  return instances[0];
}

beforeEach(() => {
  localStorage.clear();
  instances = [];
  hidden = false;
  rejectFirstPlay = false;
  speakingId.value = null;
  loadingId.value = null;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.stubGlobal("Audio", TestAudio);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Wikido exploration music", () => {
  it("ships four playable MP3 assets and public source/license credits", async () => {
    await open();
    expect(wikidoMusicTracks).toHaveLength(4);
    for (const track of wikidoMusicTracks) {
      const path = resolve("public", track.src.slice(1));
      expect(statSync(path).size).toBeGreaterThan(1_000_000);
      expect(readFileSync(path).subarray(0, 3).toString()).toBe("ID3");
      expect(wrapper.find(`a[href="${track.source}"]`).text()).toBe(track.title);
    }
    expect(wrapper.find('a[href="https://creativecommons.org/licenses/by/4.0/"]').exists()).toBe(true);
  });

  it("starts softly, remembers mute, and resumes the same track and position", async () => {
    const audio = await open();
    expect(audio.volume).toBeCloseTo(0.12);
    expect(wrapper.find(".music-toggle").attributes("aria-label")).toBe("Mute background music");
    audio.currentTime = 37;
    const src = audio.src;
    await wrapper.find(".music-toggle").trigger("click");
    expect(audio.pause).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("wikido.music.v1")).muted).toBe(true);
    await wrapper.find(".music-toggle").trigger("click");
    await flushPromises();
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(37);
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("true");
  });

  it("loads saved preferences without playing when muted", async () => {
    localStorage.setItem("wikido.music.v1", JSON.stringify({ muted: true, volume: 0.08, mode: "repeat" }));
    const audio = await open();
    expect(audio.play).not.toHaveBeenCalled();
    expect(wrapper.find("select").element.value).toBe("repeat");
    expect(wrapper.find("input").element.value).toBe("8");
    await wrapper.find(".music-toggle").trigger("click");
    await flushPromises();
    vi.advanceTimersByTime(1000);
    expect(audio.volume).toBeCloseTo(0.08);
  });

  it("plays every track before reshuffling and avoids immediate repeats", async () => {
    const audio = await open();
    const heard = [audio.src];
    for (let i = 0; i < 8; i += 1) {
      audio.dispatchEvent(new Event("ended"));
      await flushPromises();
      heard.push(audio.src);
    }
    expect(new Set(heard.slice(0, 4)).size).toBe(4);
    expect(new Set(heard.slice(4, 8)).size).toBe(4);
    for (let i = 1; i < heard.length; i += 1) expect(heard[i]).not.toBe(heard[i - 1]);
    const original = [...wikidoMusicTracks];
    const bag = shuffledTracks(original, original[0].id, () => 0.99);
    expect(bag[0].id).not.toBe(original[0].id);
    expect(original).toEqual(wikidoMusicTracks);
  });

  it("loops the selected track, supports next, and saves volume changes", async () => {
    const audio = await open();
    await wrapper.find("select").setValue("repeat");
    const src = audio.src;
    audio.currentTime = 60;
    audio.dispatchEvent(new Event("ended"));
    await flushPromises();
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(0);
    await wrapper.find(".music-next").trigger("click");
    expect(audio.src).not.toBe(src);
    await wrapper.find("input").setValue("9");
    await flushPromises();
    vi.advanceTimersByTime(1000);
    expect(audio.volume).toBeCloseTo(0.09);
    expect(JSON.parse(localStorage.getItem("wikido.music.v1")).volume).toBe(0.09);
  });

  it("ducks under narration and TTS loading, then returns to the chosen volume", async () => {
    const audio = await open();
    speakingId.value = "narration";
    await flushPromises();
    vi.advanceTimersByTime(1000);
    expect(audio.volume).toBeCloseTo(0.025);
    speakingId.value = null;
    loadingId.value = "fact";
    await flushPromises();
    vi.advanceTimersByTime(1000);
    expect(audio.volume).toBeCloseTo(0.025);
    loadingId.value = null;
    await flushPromises();
    vi.advanceTimersByTime(1000);
    expect(audio.volume).toBeCloseTo(0.12);
  });

  it("recovers from autoplay restrictions with one Play music click", async () => {
    rejectFirstPlay = true;
    const audio = await open();
    expect(wrapper.find(".music-toggle").text()).toContain("Play music");
    await wrapper.find(".music-toggle").trigger("pointerdown");
    expect(audio.play).toHaveBeenCalledTimes(1); // capture listener leaves controls to their handlers
    await wrapper.find(".music-toggle").trigger("click");
    await flushPromises();
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("true");
  });

  it("pauses in a hidden tab and releases audio when leaving the explorer", async () => {
    const audio = await open();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("true"); // Vue updates on the next tick
    await flushPromises();
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("false");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("true");
    wrapper.unmount();
    wrapper = null;
    const calls = audio.play.mock.calls.length;
    audio.dispatchEvent(new Event("ended"));
    window.dispatchEvent(new Event("pointerdown"));
    expect(audio.play).toHaveBeenCalledTimes(calls);
    expect(audio.src).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips broken files and stops after all four fail, with a manual retry", async () => {
    const audio = await open();
    for (let i = 0; i < 4; i += 1) {
      audio.dispatchEvent(new Event("error"));
      await flushPromises();
    }
    expect(wrapper.text()).toContain("Music could not load");
    expect(wrapper.find(".music-toggle").attributes("aria-label")).toBe("Play background music");
    await wrapper.find(".music-toggle").trigger("click");
    await flushPromises();
    expect(wrapper.find(".music-toggle").attributes("aria-pressed")).toBe("true");
  });
});
