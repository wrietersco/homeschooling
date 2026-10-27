<script setup>
// A child's face: their uploaded photo, or a coloured bubble with their initial.
// `child` may be null for "everyone" (shows a little group bubble).
import { computed } from "vue";

const props = defineProps({
  child: { type: Object, default: null },
  size: { type: Number, default: 28 },
});

const COLORS = ["#FF8FB1", "#6FD3FF", "#7FE3A6", "#FFB25A", "#C39BFF", "#FF9D7A", "#6FE3D2", "#FFE45C"];
const color = computed(() => {
  const s = props.child?.id || props.child?.name || "";
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
});
const initial = computed(() => (props.child?.name || "?").trim().charAt(0).toUpperCase());
</script>

<template>
  <span
    class="avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.46)}px`, background: child?.photo ? '#fff' : color }"
    :title="child ? child.name : 'All children'"
  >
    <img v-if="child?.photo" :src="child.photo" :alt="child.name" />
    <svg v-else-if="!child" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="11" cy="12" r="5" fill="#fff" /><circle cx="21" cy="12" r="5" fill="#fff" opacity=".85" />
      <path d="M2 28 Q11 16 20 28 Z" fill="#fff" /><path d="M12 28 Q21 16 30 28 Z" fill="#fff" opacity=".85" />
    </svg>
    <span v-else>{{ initial }}</span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border-radius: 50%; overflow: hidden; color: #fff; font-weight: 800;
  font-family: "Baloo 2", system-ui, sans-serif; line-height: 1;
  border: 2px solid #fff; box-shadow: 0 2px 4px rgba(58, 43, 82, 0.18);
}
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avatar svg { width: 72%; height: 72%; }
</style>
