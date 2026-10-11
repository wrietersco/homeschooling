<script setup>
// One tappable place on a Wikido scene image: an anchor dot glued to the artwork
// (x/y are percentages of the image) with its always-visible label pill above it,
// Gemini-Immersive style. Hotspots that open a deeper scene show a door icon so a
// child can tell "look at this" apart from "go in here".
import { computed } from "vue";

const props = defineProps({
  spot: { type: Object, required: true },
  seen: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
  // Optional on-screen placement in px (computed through the cover transform).
  // When absent the raw picture percentages are used.
  placement: { type: Object, default: null },
});
const emit = defineEmits(["select", "activate"]);
const style = computed(() =>
  props.placement
    ? { left: `${props.placement.left}px`, top: `${props.placement.top}px` }
    : { left: `${props.spot.x}%`, top: `${props.spot.y}%` }
);

// Near the screen edges the pill would clip — pin it to the inner side instead.
const edgeClass = computed(() => {
  if (props.spot.x > 82) return "edge-right";
  if (props.spot.x < 14) return "edge-left";
  return "";
});
</script>

<template>
  <button
    type="button"
    class="wd-hot"
    :class="[edgeClass, { open, seen }]"
    :style="style"
    :aria-label="`${spot.label}${spot.childSceneId ? ' — step inside' : ''}`"
    @click="emit('select')"
    @dblclick.stop="emit('activate')"
  >
    <span class="wd-dot" aria-hidden="true">
      <span class="material-symbols-rounded wd-dot-check">check</span>
    </span>
    <span class="wd-pill">
      <span class="material-symbols-rounded wd-pill-ico" aria-hidden="true">{{ spot.childSceneId ? "door_open" : "search" }}</span>
      <span class="wd-pill-txt">{{ spot.label }}</span>
    </span>
  </button>
</template>

<style scoped>
.wd-hot {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  z-index: 5;
}
.wd-hot:hover, .wd-hot.open { z-index: 8; }
.wd-hot:focus-visible { outline: none; }
.wd-hot:focus-visible .wd-dot { box-shadow: 0 0 0 4px rgba(255, 214, 130, .9), 0 0 0 8px rgba(76, 29, 149, .35); }

/* anchor dot */
.wd-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 252, 244, .92);
  border: 3px solid #4C1D95;
  box-shadow: 0 1px 8px rgba(20, 10, 40, .45);
  display: grid;
  place-items: center;
  transition: transform .15s ease, background .15s ease;
}
.wd-hot:hover .wd-dot, .wd-hot.open .wd-dot { transform: translate(-50%, -50%) scale(1.28); }
.wd-hot.open .wd-dot { background: #FDE68A; }
.wd-dot-check {
  font-size: 15px;
  color: #065F46;
  display: none;
}
.wd-hot.seen .wd-dot-check { display: block; }
.wd-hot.seen .wd-dot { background: #BBF7D0; }
.wd-hot.open.seen .wd-dot { background: #FDE68A; }

/* gentle pulse on the currently-open spot */
.wd-hot.open::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 3px solid rgba(253, 230, 138, .9);
  animation: wd-pulse 1.6s ease-out infinite;
}
@keyframes wd-pulse {
  0% { width: 22px; height: 22px; opacity: .9; }
  100% { width: 64px; height: 64px; opacity: 0; }
}

/* dotted connector from dot up to the pill */
.wd-hot::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 24px;
  height: 16px;
  border-left: 2px dotted rgba(255, 255, 255, .95);
  filter: drop-shadow(0 1px 1px rgba(20, 10, 40, .5));
}

/* label pill */
.wd-pill {
  position: absolute;
  bottom: 42px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.38rem 0.75rem;
  border-radius: 999px;
  background: rgba(255, 253, 247, .95);
  border: 1.5px solid rgba(76, 29, 149, .25);
  box-shadow: 0 4px 14px rgba(20, 10, 40, .35);
  color: #3B0764;
  font-size: 0.86rem;
  font-weight: 700;
  white-space: nowrap;
  transition: transform .15s ease, box-shadow .15s ease;
}
.wd-hot:hover .wd-pill, .wd-hot.open .wd-pill {
  transform: translateX(-50%) scale(1.06);
  box-shadow: 0 6px 20px rgba(20, 10, 40, .45);
}
.wd-pill-ico { font-size: 15px; color: #7C3AED; }
.wd-hot:has(.wd-pill) { /* keep the pill clickable as part of the button */ }

/* edge pinning */
.wd-hot.edge-right .wd-pill { left: auto; right: -6px; transform: none; }
.wd-hot.edge-right:hover .wd-pill, .wd-hot.edge-right.open .wd-pill { transform: scale(1.06); }
.wd-hot.edge-left .wd-pill { left: -6px; transform: none; }
.wd-hot.edge-left:hover .wd-pill, .wd-hot.edge-left.open .wd-pill { transform: scale(1.06); }
.wd-hot.edge-right::after { left: auto; right: 12px; }
.wd-hot.edge-left::after { left: 12px; }
</style>
