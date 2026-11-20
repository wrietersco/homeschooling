<script setup>
// Hikmah the owl — the Home mascot. A wise little scholar owl whose pupils
// follow the cursor, who blinks every few seconds, waves her wing on hover /
// tap, and chats through a speech bubble with rotating encouragements.
// Kids notice the eyes following them within about two seconds — that's the
// "this app is alive" moment the old home screen never had.
import { onBeforeUnmount, onMounted, ref } from "vue";

const emit = defineEmits(["cheep"]);

const LINES = [
  "As-salaamu alaykum, explorer!",
  "Ready for today's adventure?",
  "Every book is a magic doorway!",
  "Small steps grow BIG wisdom!",
  "Did you know? Owls love asking questions!",
  "Let's make today amazing!",
];

const lineIndex = ref(0);
const waving = ref(false);
const root = ref(null);

// Pupil tracking: normalised offset from the owl's centre, clamped to a
// ±5px wander so the pupils stay inside the eyes. rAF-throttled.
const look = ref({ x: 0, y: 0 });
let raf = 0;
let waveTimer = 0;

function onMove(e) {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = root.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = (e.clientX - cx) / Math.max(r.width, 1);
    const dy = (e.clientY - cy) / Math.max(r.height, 1);
    look.value = {
      x: Math.max(-5, Math.min(5, dx * 14)),
      y: Math.max(-4, Math.min(4, dy * 10)),
    };
  });
}

function nextLine() {
  lineIndex.value = (lineIndex.value + 1) % LINES.length;
}

function cheep(e) {
  waving.value = true;
  clearTimeout(waveTimer);
  waveTimer = setTimeout(() => (waving.value = false), 1300);
  nextLine();
  emit("cheep", e);
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.addEventListener("mousemove", onMove, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onMove);
  cancelAnimationFrame(raf);
  clearTimeout(waveTimer);
});
</script>

<template>
  <div ref="root" class="owl" :class="{ waving }" role="img" aria-label="Hikmah the owl mascot" :style="{ '--lx': look.x + 'px', '--ly': look.y + 'px' }">
    <div class="bubble" @click="cheep">
      <Transition name="pop" mode="out-in">
        <span :key="lineIndex" class="bubble-line">{{ LINES[lineIndex] }}</span>
      </Transition>
      <span class="tail" />
    </div>

    <svg viewBox="0 0 240 256" class="owl-svg" @click="cheep">
      <defs>
        <linearGradient id="owl-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#A78BFA" />
          <stop offset="1" stop-color="#7C3AED" />
        </linearGradient>
        <linearGradient id="owl-belly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFF7E8" />
          <stop offset="1" stop-color="#FFE9C8" />
        </linearGradient>
      </defs>

      <!-- One gentle bob for the whole bird -->
      <g class="bob">
        <!-- ear tufts -->
        <path d="M64,92 Q54,58 78,50 Q80,74 92,84 Z" fill="#7C3AED" />
        <path d="M176,92 Q186,58 162,50 Q160,74 148,84 Z" fill="#7C3AED" />

        <!-- body -->
        <ellipse cx="120" cy="146" rx="80" ry="85" fill="url(#owl-body)" />

        <!-- face patches -->
        <circle cx="95" cy="112" r="36" fill="#FFF6E5" />
        <circle cx="145" cy="112" r="36" fill="#FFF6E5" />

        <!-- eyes: lids blink, pupils follow the cursor -->
        <g>
          <circle cx="95" cy="110" r="23" fill="#fff" />
          <circle cx="145" cy="110" r="23" fill="#fff" />
          <g class="pupils">
            <circle cx="95" cy="110" r="11" fill="#3A2C5F" />
            <circle cx="145" cy="110" r="11" fill="#3A2C5F" />
            <circle cx="99" cy="106" r="3.6" fill="#fff" />
            <circle cx="149" cy="106" r="3.6" fill="#fff" />
            <circle cx="92" cy="113" r="2" fill="#fff" opacity="0.8" />
            <circle cx="142" cy="113" r="2" fill="#fff" opacity="0.8" />
          </g>
          <circle class="lid lid-l" cx="95" cy="110" r="23.5" fill="#FFF6E5" />
          <circle class="lid lid-r" cx="145" cy="110" r="23.5" fill="#FFF6E5" />
        </g>

        <!-- cheeks + beak -->
        <ellipse cx="76" cy="138" rx="9" ry="6" fill="#FFB3C1" opacity="0.75" />
        <ellipse cx="164" cy="138" rx="9" ry="6" fill="#FFB3C1" opacity="0.75" />
        <path d="M120,128 C131,134 132,143 120,153 C108,143 109,134 120,128 Z" fill="#FF9F45" stroke="#E8842F" stroke-width="1.5" />

        <!-- belly with feather scallops -->
        <ellipse cx="120" cy="192" rx="50" ry="44" fill="url(#owl-belly)" />
        <g fill="none" stroke="#EFD9B8" stroke-width="2.5" stroke-linecap="round">
          <path d="M86,178 Q98,190 110,178" />
          <path d="M130,178 Q142,190 154,178" />
          <path d="M100,198 Q112,210 124,198" />
          <path d="M120,182 Q126,188 132,182" opacity="0.7" />
        </g>

        <!-- wings: right rests, left waves on hover/tap -->
        <path class="wing-r" d="M194,134 Q212,162 199,194 Q184,210 165,199 Q180,170 178,142 Q186,128 194,134 Z" fill="#6D28D9" />
        <path class="wing-l" d="M46,134 Q28,162 41,194 Q56,210 75,199 Q60,170 62,142 Q54,128 46,134 Z" fill="#6D28D9" />

        <!-- feet -->
        <g fill="#FF9F45">
          <ellipse cx="96" cy="231" rx="6" ry="5.5" /><ellipse cx="107" cy="233" rx="6" ry="5.5" /><ellipse cx="118" cy="231" rx="6" ry="5.5" />
          <ellipse cx="122" cy="231" rx="6" ry="5.5" /><ellipse cx="133" cy="233" rx="6" ry="5.5" /><ellipse cx="144" cy="231" rx="6" ry="5.5" />
        </g>

        <!-- scholar's mortarboard + swaying tassel -->
        <g transform="translate(120 40)">
          <path d="M-26,10 Q0,22 26,10 L26,2 Q0,12 -26,2 Z" fill="#3B1B76" />
          <g class="tassel">
            <path d="M52,0 L58,26" stroke="#FFC93C" stroke-width="3" stroke-linecap="round" />
            <circle cx="58" cy="28" r="5" fill="#FFC93C" />
          </g>
          <path d="M0,-14 L52,0 L0,14 L-52,0 Z" fill="#4C1D95" stroke="#3B1B76" stroke-width="2" />
          <circle cx="0" cy="0" r="3.5" fill="#FFD54F" />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.owl {
  position: relative;
  width: 230px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.owl-svg {
  width: 100%;
  height: auto;
  display: block;
  filter: drop-shadow(0 14px 18px rgba(59, 7, 100, 0.28));
}

.bob { transform-box: fill-box; transform-origin: center; animation: owl-bob 3.2s ease-in-out infinite alternate; }
.pupils { transform: translate(var(--lx, 0px), var(--ly, 0px)); transition: transform 0.12s ease-out; }
.lid { transform-box: fill-box; transform-origin: center top; transform: scaleY(0.05); animation: owl-blink 5.2s infinite; }
.lid-r { animation-delay: 0.06s; }
.wing-l { transform-box: fill-box; transform-origin: 78% 12%; }
.owl:hover .wing-l, .owl.waving .wing-l { animation: owl-wave 0.9s ease-in-out; }
.tassel { transform-box: fill-box; transform-origin: top left; animation: owl-tassel 3.6s ease-in-out infinite alternate; }

@keyframes owl-bob { from { transform: translateY(-5px); } to { transform: translateY(5px); } }
@keyframes owl-blink {
  0%, 91%, 100% { transform: scaleY(0.05); }
  94.5% { transform: scaleY(1); }
  97% { transform: scaleY(0.05); }
}
@keyframes owl-wave {
  0% { transform: rotate(0); }
  25% { transform: rotate(-52deg); }
  50% { transform: rotate(-8deg); }
  75% { transform: rotate(-48deg); }
  100% { transform: rotate(0); }
}
@keyframes owl-tassel { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }

/* Speech bubble */
.bubble {
  position: absolute;
  top: -64px;
  left: 12px;
  z-index: 2;
  max-width: 250px;
  background: #fff;
  border: 3px solid #F1DEB8;
  border-radius: 18px;
  padding: 0.5rem 0.8rem;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.92rem;
  line-height: 1.3;
  color: #6D28D9;
  box-shadow: 0 8px 18px rgba(59, 7, 100, 0.18);
  animation: owl-float 3.2s ease-in-out infinite alternate;
}
.tail {
  position: absolute;
  bottom: -10px;
  left: 34px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-right: 3px solid #F1DEB8;
  border-bottom: 3px solid #F1DEB8;
  transform: rotate(45deg);
  border-bottom-right-radius: 4px;
}
@keyframes owl-float { from { transform: translateY(-3px); } to { transform: translateY(3px); } }

.pop-enter-active { animation: owl-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pop-leave-active { animation: owl-pop 0.18s reverse; }
@keyframes owl-pop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .bob, .lid, .tassel, .bubble { animation: none !important; }
  .lid { transform: scaleY(0); }
}
</style>
