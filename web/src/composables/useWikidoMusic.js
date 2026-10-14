import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { wikidoMusicTracks, shuffledTracks } from "@/lib/wikido/music";

const KEY = "wikido.music.v1";
const MAX_VOLUME = 0.25;
const DEFAULT_VOLUME = 0.12;
const DUCK_VOLUME = 0.025;

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; }
  catch { return {}; }
}

// Owned by the explorer, independently of its current scene and spoken audio.
export function useWikidoMusic({ speakingId, loadingId }) {
  const preferences = readPreferences();
  const muted = ref(preferences.muted === true);
  const volume = ref(typeof preferences.volume === "number" && Number.isFinite(preferences.volume)
    ? Math.max(0, Math.min(MAX_VOLUME, preferences.volume)) : DEFAULT_VOLUME);
  const mode = ref(preferences.mode === "repeat" ? "repeat" : "shuffle");
  const playing = ref(false);
  const blocked = ref(false);
  const unavailable = ref(false);
  const track = ref(null);
  const narrationActive = computed(() => Boolean(speakingId?.value || loadingId?.value));
  const targetVolume = computed(() => narrationActive.value ? Math.min(volume.value, DUCK_VOLUME) : volume.value);
  let audio = null;
  let queue = [];
  let destroyed = false;
  let playToken = 0;
  let fadeTimer = null;
  const failed = new Set();

  function fadeVolume() {
    clearInterval(fadeTimer);
    if (!audio) return;
    fadeTimer = setInterval(() => {
      const delta = targetVolume.value - audio.volume;
      if (Math.abs(delta) <= 0.008) {
        audio.volume = targetVolume.value;
        clearInterval(fadeTimer);
      } else audio.volume = Math.max(0, Math.min(1, audio.volume + Math.sign(delta) * 0.008));
    }, 40);
  }

  function pause() {
    playToken += 1;
    clearInterval(fadeTimer);
    audio?.pause();
    playing.value = false;
  }

  async function play() {
    if (!audio || muted.value || document.hidden || destroyed || unavailable.value) return;
    const token = ++playToken;
    try {
      await audio.play();
      if (destroyed || token !== playToken) return;
      playing.value = true;
      blocked.value = false;
      fadeVolume();
    } catch (error) {
      if (destroyed || token !== playToken) return;
      playing.value = false;
      if (error?.name === "NotAllowedError") blocked.value = true;
      else if (error?.name !== "AbortError") failTrack();
    }
  }

  function next() {
    if (!audio || destroyed) return;
    pause();
    const available = wikidoMusicTracks.filter((t) => !failed.has(t.id));
    if (!available.length) { unavailable.value = true; return; }
    queue = queue.filter((t) => !failed.has(t.id));
    if (!queue.length) queue = shuffledTracks(available, track.value?.id);
    track.value = queue.shift();
    audio.src = track.value.src;
    audio.volume = 0;
    unavailable.value = false;
    void play();
  }

  function failTrack() {
    // An error event and a rejected play() can both report the same failure.
    // next() changes playToken, so the stale rejection is ignored.
    if (track.value) failed.add(track.value.id);
    next();
  }

  function ended() {
    playing.value = false;
    if (mode.value === "repeat" && audio) {
      audio.currentTime = 0;
      void play();
    } else next();
  }

  function toggleMute() {
    if (blocked.value || unavailable.value) {
      muted.value = false;
      if (unavailable.value) { failed.clear(); queue = []; next(); }
      else void play();
    } else {
      muted.value = !muted.value;
      if (muted.value) pause();
      else void play();
    }
  }

  function retryAutoplay(event) {
    if (event.target?.closest?.(".wd-music")) return;
    if (blocked.value && !muted.value) void play();
  }

  function visibilityChanged() {
    if (document.hidden) pause();
    else void play();
  }

  watch([muted, volume, mode], () => {
    try { localStorage.setItem(KEY, JSON.stringify({ muted: muted.value, volume: volume.value, mode: mode.value })); }
    catch { /* Music controls work when browser storage is disabled. */ }
  });
  watch(targetVolume, fadeVolume);

  onMounted(() => {
    audio = new Audio();
    audio.preload = "metadata";
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failTrack);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pointerdown", retryAutoplay, true);
    window.addEventListener("keydown", retryAutoplay, true);
    next();
  });

  onBeforeUnmount(() => {
    destroyed = true;
    pause();
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pointerdown", retryAutoplay, true);
    window.removeEventListener("keydown", retryAutoplay, true);
    audio?.removeEventListener("ended", ended);
    audio?.removeEventListener("error", failTrack);
    audio?.removeAttribute("src");
    audio?.load();
    audio = null;
  });

  return { muted, volume, mode, playing, blocked, unavailable, track, next, toggleMute };
}
