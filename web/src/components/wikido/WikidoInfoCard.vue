<script setup>
// The detail card that slides in when a child taps a hotspot: what it is, a fun
// fact, a Listen button (TTS — the "read it to me" path), and — when the hotspot
// leads somewhere deeper — the big "Step inside" call to action. A cross-topic
// doorway names the world it opens instead, or explains the door is dormant
// when that world isn't published yet.
import { computed } from "vue";
import SpeakButton from "@/components/SpeakButton.vue";
import { resolveWikidoAudioUrl } from "@/lib/wikido/audio";

const props = defineProps({
  spot: { type: Object, required: true },
  // cross: the doorway opens a scene in a DIFFERENT topic/world
  cross: { type: Boolean, default: false },
  // title of that other world (for the call to action)
  crossTitle: { type: String, default: "" },
  // false = the other world isn't available (draft/missing) — door is dormant
  openable: { type: Boolean, default: true },
});
const emit = defineEmits(["close", "enter"]);

const isDoor = computed(() => Boolean(props.spot.childSceneId));
const spoken = computed(() =>
  [props.spot.info.title, ...props.spot.info.body, props.spot.info.fact ? `Fun fact! ${props.spot.info.fact}` : ""]
    .filter(Boolean)
    .join(" ")
);
const audioUrl = computed(() => resolveWikidoAudioUrl(props.spot.audio || ""));
const enterLabel = computed(() => (props.cross ? `Step into ${props.crossTitle || "another world"}` : "Step inside"));
</script>

<template>
  <article class="wd-info">
    <header class="wd-info-head">
      <span class="wd-kind" :class="{ deeper: isDoor && !cross, world: cross }">
        <span class="material-symbols-rounded" aria-hidden="true">{{ cross ? "travel_explore" : isDoor ? "door_open" : "search" }}</span>
        {{ cross ? "A doorway to another world" : isDoor ? "You can go inside" : "Take a look" }}
      </span>
      <button type="button" class="wd-close" aria-label="Close" @click="emit('close')">
        <span class="material-symbols-rounded">close</span>
      </button>
    </header>

    <h2 class="wd-info-title">{{ spot.info.title }}</h2>
    <p v-for="(para, i) in spot.info.body" :key="i" class="wd-info-para">{{ para }}</p>

    <div v-if="spot.info.fact" class="wd-fact">
      <span class="material-symbols-rounded wd-fact-ico" aria-hidden="true">auto_awesome</span>
      <p><strong>Fun fact!</strong> {{ spot.info.fact }}</p>
    </div>

    <footer class="wd-info-foot">
      <SpeakButton :text="spoken" :audio-url="audioUrl" size="lg" label="Listen" content-kind="story" class="wd-info-listen" />
      <button v-if="isDoor && openable" type="button" class="wd-enter" @click="emit('enter')">
        {{ enterLabel }}
        <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
      </button>
    </footer>
    <p v-if="isDoor && !openable" class="wd-locked">That world isn't open yet — check the Wikido shelf later!</p>
    <p v-if="isDoor" class="wd-hint">Tip: double-tap a doorway to step right in!</p>
  </article>
</template>

<style scoped>
.wd-info {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: min(380px, calc(100vw - 48px));
  max-height: calc(100% - 140px);
  overflow-y: auto;
  padding: 1rem 1.1rem 1.1rem;
  border-radius: 20px;
  background: rgba(255, 253, 247, .97);
  border: 1.5px solid rgba(76, 29, 149, .18);
  box-shadow: 0 18px 50px rgba(20, 10, 40, .45);
  color: #3B0764;
}

.wd-info-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.wd-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #6D28D9;
  background: #F3E8FF;
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
}
.wd-kind .material-symbols-rounded { font-size: 14px; }
.wd-kind.deeper { color: #9A3412; background: #FED7AA; }
.wd-kind.world { color: #92400E; background: #FDE68A; }
.wd-close {
  border: none;
  background: none;
  cursor: pointer;
  color: #6B7280;
  padding: 0.2rem;
  border-radius: 8px;
  display: grid;
  place-items: center;
}
.wd-close:hover { background: #F3E8FF; color: #4C1D95; }
.wd-close .material-symbols-rounded { font-size: 20px; }

.wd-info-title { margin: 0; font-size: 1.45rem; line-height: 1.15; }
.wd-info-para { margin: 0; font-size: 0.95rem; line-height: 1.5; color: #4B5563; }

.wd-fact {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  background: #FEF9C3;
  border: 1.5px dashed #EAB308;
  border-radius: 14px;
  padding: 0.6rem 0.75rem;
  margin-top: 0.15rem;
}
.wd-fact p { margin: 0; font-size: 0.86rem; line-height: 1.45; color: #713F12; }
.wd-fact-ico { font-size: 20px; color: #EAB308; flex-shrink: 0; }

.wd-info-foot { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.3rem; flex-wrap: wrap; }

.wd-enter {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: none;
  cursor: pointer;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #EA580C, #D97706);
  box-shadow: 0 4px 14px rgba(234, 88, 12, .45);
  transition: transform .12s ease, filter .12s ease;
  font-family: inherit;
}
.wd-enter:hover { filter: brightness(1.08); transform: translateY(-1px); }
.wd-enter .material-symbols-rounded { font-size: 18px; }

.wd-hint { margin: 0; font-size: 0.75rem; color: #9CA3AF; font-style: italic; }

.wd-locked {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: #92400E;
  background: #FEF3C7;
  border: 1.5px dashed #F59E0B;
  border-radius: 12px;
  padding: 0.5rem 0.7rem;
}
</style>
