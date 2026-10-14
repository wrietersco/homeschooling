<script setup>
import { computed } from "vue";
import { useSpeech } from "@/composables/useSpeech";
import { useWikidoMusic } from "@/composables/useWikidoMusic";
import { wikidoMusicTracks, WIKIDO_MUSIC_LICENSE, WIKIDO_MUSIC_AUTHOR_URL } from "@/lib/wikido/music";

const { speakingId, loadingId } = useSpeech();
const { muted, volume, mode, playing, blocked, unavailable, track, next, toggleMute } = useWikidoMusic({ speakingId, loadingId });
const actionLabel = computed(() => muted.value || blocked.value || unavailable.value ? "Play background music" : "Mute background music");
const volumePercent = computed({ get: () => Math.round(volume.value * 100), set: (n) => { volume.value = Math.min(25, Math.max(0, Number(n))) / 100; } });
</script>

<template>
  <div class="wd-music">
    <button type="button" class="music-toggle" :aria-label="actionLabel" :title="actionLabel" :aria-pressed="playing" @click="toggleMute">
      <span class="material-symbols-rounded" aria-hidden="true">{{ muted || blocked || unavailable ? 'music_off' : 'music_note' }}</span>
      <span>{{ muted ? 'Music off' : blocked || unavailable ? 'Play music' : 'Music on' }}</span>
    </button>
    <details class="music-options">
      <summary aria-label="Music options" title="Music options"><span class="material-symbols-rounded" aria-hidden="true">expand_more</span></summary>
      <div class="music-panel">
        <strong>Exploration music</strong>
        <p class="now-playing">{{ track?.title }} · Scott Buckley</p>
        <p v-if="unavailable" role="status">Music could not load. Press Play music to try again.</p>
        <p v-else-if="blocked" role="status">Press Play music to start listening.</p>
        <label>Music volume <span>{{ volumePercent }}%</span>
          <input v-model="volumePercent" type="range" min="0" max="25" step="1" aria-label="Music volume" />
        </label>
        <label>Play mode
          <select v-model="mode" aria-label="Music play mode">
            <option value="shuffle">Shuffle &amp; repeat all</option>
            <option value="repeat">Repeat this track</option>
          </select>
        </label>
        <button type="button" class="music-next" :disabled="unavailable" @click="next">Next track →</button>
        <p class="music-hint">Music becomes quieter while you listen to a story.</p>
        <details class="music-credits">
          <summary>Music credits</summary>
          <p>Music by <a :href="WIKIDO_MUSIC_AUTHOR_URL" target="_blank" rel="noopener noreferrer">Scott Buckley</a> — released under
            <a :href="WIKIDO_MUSIC_LICENSE" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.</p>
          <ul><li v-for="item in wikidoMusicTracks" :key="item.id"><a :href="item.source" target="_blank" rel="noopener noreferrer">{{ item.title }}</a></li></ul>
        </details>
      </div>
    </details>
  </div>
</template>

<style scoped>
.wd-music { position: relative; display: flex; align-items: center; border: 1.5px solid rgba(255,255,255,.35); border-radius: 22px; color: #fff7ea; background: rgba(30,18,52,.8); backdrop-filter: blur(6px); }
.music-toggle { display: flex; gap: .3rem; align-items: center; padding: .45rem .65rem; background: none; border: 0; color: inherit; font: inherit; font-size: .8rem; cursor: pointer; border-radius: 22px; }
.music-toggle .material-symbols-rounded { font-size: 20px; }
.music-options > summary { display: flex; cursor: pointer; padding: .3rem .3rem .3rem 0; list-style: none; border-radius: 18px; }
.music-options > summary::-webkit-details-marker { display: none; }
.music-panel { position: absolute; right: 0; top: calc(100% + .65rem); width: 280px; max-height: calc(100vh - 110px); overflow: auto; padding: 1rem; border: 1px solid rgba(255,255,255,.3); border-radius: 16px; background: #241533; box-shadow: 0 12px 32px #0005; font-size: .85rem; }
.now-playing { color: #fde68a; margin: .4rem 0 1rem; }
.music-panel label { display: block; margin: .8rem 0; }
.music-panel label span { float: right; }
.music-panel input, .music-panel select { display: block; width: 100%; margin-top: .4rem; accent-color: #fde68a; }
.music-panel select { color: #fff7ea; background: #3b1d5e; border: 1px solid #ffffff55; padding: .4rem; border-radius: 8px; font: inherit; }
.music-next { color: #241533; background: #fde68a; border: 0; padding: .4rem .7rem; border-radius: 8px; font: inherit; cursor: pointer; }
.music-hint, .music-credits { font-size: .75rem; line-height: 1.5; color: #fff7ead9; }
.music-credits summary { cursor: pointer; }
.music-credits a { color: #fde68a; }
.music-toggle:focus-visible, summary:focus-visible, .music-next:focus-visible { outline: 3px solid #fde68a; outline-offset: 3px; }
</style>
