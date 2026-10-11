<script setup>
// One big card on the Wikido shelf: a topic's cover, tagline, and how much of it
// has been discovered so far. The whole card is the button.
defineProps({
  topic: { type: Object, required: true }, // shelf summary from services/wikido
  seen: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  draft: { type: Boolean, default: false }, // studio topics still in draft (superadmin preview)
});
const emit = defineEmits(["open"]);
</script>

<template>
  <button type="button" class="wd-topic" @click="emit('open', topic)">
    <span class="wd-topic-cover">
      <img :src="topic.cover.src" :alt="topic.cover.alt" loading="lazy" draggable="false" />
      <span class="wd-topic-emoji" aria-hidden="true">{{ topic.emoji }}</span>
      <span v-if="draft" class="wd-topic-draft">Draft preview</span>
    </span>
    <span class="wd-topic-body">
      <span class="wd-topic-name">{{ topic.title }}</span>
      <span class="wd-topic-tag">{{ topic.tagline }}</span>
      <span class="wd-topic-meta">
        <span class="wd-topic-places">
          <span class="material-symbols-rounded" aria-hidden="true">map</span>
          {{ topic.sceneCount }} place{{ topic.sceneCount === 1 ? "" : "s" }}
        </span>
        <span v-if="total" class="wd-topic-progress" :class="{ done: seen >= total }">
          <span class="material-symbols-rounded" aria-hidden="true">{{ seen >= total ? "workspace_premium" : "explore" }}</span>
          {{ seen }} of {{ total }} discovered
        </span>
      </span>
    </span>
    <span class="wd-topic-go">
      <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
    </span>
  </button>
</template>

<style scoped>
.wd-topic {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: 2px solid rgba(255, 255, 255, .18);
  border-radius: 24px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(255, 253, 247, .08);
  color: #FFF7EA;
  text-align: left;
  font-family: inherit;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.wd-topic:hover { transform: translateY(-4px); box-shadow: 0 20px 50px rgba(10, 5, 25, .5); border-color: rgba(253, 230, 138, .6); }
.wd-topic:focus-visible { outline: 3px solid #FDE68A; outline-offset: 2px; }

.wd-topic-cover { position: relative; display: block; aspect-ratio: 16 / 8; overflow: hidden; }
.wd-topic-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wd-topic-emoji {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-size: 2rem;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, .4));
}
.wd-topic-draft {
  position: absolute;
  right: 10px;
  top: 10px;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #713F12;
  background: #FDE68A;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}

.wd-topic-body { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.9rem 1rem 1rem; }
.wd-topic-name { font-size: 1.35rem; font-weight: 800; line-height: 1.1; }
.wd-topic-tag { font-size: 0.9rem; line-height: 1.4; color: rgba(255, 247, 234, .82); }

.wd-topic-meta { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.35rem; }
.wd-topic-places, .wd-topic-progress {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.76rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  background: rgba(255, 255, 255, .14);
}
.wd-topic-places .material-symbols-rounded, .wd-topic-progress .material-symbols-rounded { font-size: 15px; }
.wd-topic-progress { background: rgba(187, 247, 208, .18); color: #D9FBE6; }
.wd-topic-progress.done { background: #FDE68A; color: #713F12; }

.wd-topic-go {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #EA580C, #D97706);
  box-shadow: 0 6px 18px rgba(234, 88, 12, .5);
  transition: transform .15s ease;
}
.wd-topic:hover .wd-topic-go { transform: translateX(3px); }
</style>
