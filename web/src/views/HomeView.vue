<script setup>
// Home = the House of Wisdom playground. A living sky (time-of-day aware),
// Hikmah the owl mascot with cursor-following eyes, a candy CTA that fires
// confetti, and the app's six real destinations re-imagined as chunky game
// "adventure portals" in a frosted bottom-sheet world. Parents still get the
// facts (each portal carries its honest one-liner) — kids get a world.
import { RouterLink } from "vue-router";
import { computed } from "vue";
import confetti from "canvas-confetti";
import { useAuthStore } from "@/stores/auth";
import skyMode from "@/lib/skyMode";
import SkyScene from "@/components/home/SkyScene.vue";
import HikmahOwl from "@/components/home/HikmahOwl.vue";
import PortalCard from "@/components/home/PortalCard.vue";

const auth = useAuthStore();
const mode = skyMode();

// Per-letter candy title, bounced in one letter at a time.
const TITLE = "Dar-al-Hikmah";
const LETTER_COLORS = ["#FF5FA2", "#FF9F45", "#FFC93C", "#3EC28F", "#3FA7FF", "#A259FF"];

const CTA_COLORS = ["#FF5FA2", "#FFC93C", "#3EC28F", "#3FA7FF", "#A259FF", "#FF9F45"];

function burst(x, y) {
  confetti({
    particleCount: 90,
    spread: 78,
    startVelocity: 42,
    scalar: 0.95,
    ticks: 190,
    origin: { x, y },
    colors: CTA_COLORS,
    disableForReducedMotion: true,
  });
}

function burstAt(el, dy = 0.5) {
  const r = el.getBoundingClientRect();
  burst((r.left + r.width / 2) / window.innerWidth, (r.top + r.height * dy) / window.innerHeight);
}

const cta = computed(() => (auth.user ? { to: "/dashboard", label: "Go to dashboard" } : { to: "/login", label: "Start the adventure" }));
</script>

<template>
  <section class="stage" :style="{ '--sky-a': mode.sky[0], '--sky-b': mode.sky[2] }">
    <SkyScene :mode="mode" />

    <!-- Hero: owl + candy title + CTA -->
    <div class="hero">
      <HikmahOwl class="hero-owl" @cheep="burstAt($event.currentTarget || $event.target, 0.3)" />
      <div class="hero-copy">
        <h1 class="brand" aria-label="Dar-al-Hikmah OS">
          <span
            v-for="(ch, i) in TITLE.split('')"
            :key="i"
            class="ltr"
            :style="{ '--i': i, '--c': LETTER_COLORS[i % LETTER_COLORS.length] }"
            aria-hidden="true"
          >{{ ch }}</span>
          <span class="os-chip" aria-hidden="true">OS</span>
        </h1>
        <p class="kid-tag">Where little explorers grow <b>BIG</b> wisdom!</p>
        <p class="parent-lede">
          A homeschool command center for parents — values-guided curriculum, an AI-built
          6-month syllabus, a one-hand weekly planner, and a dual-view activity player.
        </p>
        <div class="cta-row">
          <RouterLink class="btn-candy" :to="cta.to" @click="burstAt($event.currentTarget, 0.4)">
            <span class="material-symbols-rounded">rocket_launch</span>
            {{ cta.label }}
          </RouterLink>
          <RouterLink class="btn-peek" to="/explore">
            <span class="material-symbols-rounded">sports_esports</span>
            Peek at the games
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- World map: six adventure portals in a frosted bottom sheet -->
    <div class="world">
      <h2 class="world-title">Pick your adventure!</h2>

      <div class="portal-grid">
        <PortalCard
          to="/guide" title="Guiding Light" kid="Ask away!" sub="An assistant that knows your family — every answer grounded in your values."
          tint="#FFE1EE" ink="#C2255C" shade="#F2A9C7" :tilt="-2" :delay="60"
        >
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="lh-beam" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#FFF3B0" stop-opacity="0.9" />
                <stop offset="1" stop-color="#FFF3B0" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path class="art-beam" d="M60,42 L112,26 L112,58 Z" fill="url(#lh-beam)" />
            <ellipse cx="60" cy="102" rx="28" ry="9" fill="#B39BB8" />
            <path d="M50,96 L54,48 L66,48 L70,96 Z" fill="#fff" />
            <path d="M50,96 L52.6,76 L67.4,76 L70,96 Z" fill="#FF6B8A" />
            <path d="M53.4,64 L54,48 L66,48 L66.6,64 Z" fill="#FF6B8A" />
            <circle class="art-glow" cx="60" cy="38" r="17" fill="#FFE98A" opacity="0.45" />
            <rect x="53" y="32" width="14" height="12" rx="2" fill="#FFD54F" />
            <rect x="45" y="44" width="30" height="5" rx="2.5" fill="#5B4470" />
            <path d="M50,32 L60,22 L70,32 Z" fill="#5B4470" />
            <rect x="55" y="84" width="10" height="12" rx="5" fill="#5B4470" />
            <path d="M24,102 q7,-7 14,0 M82,102 q7,-7 14,0" stroke="#7CC7FF" stroke-width="3" fill="none" stroke-linecap="round" />
          </svg>
        </PortalCard>

        <PortalCard
          to="/syllabus" title="AI Syllabus" kid="Wish it → built!" sub="Chat with an AI agent and it builds your 6-month learning plan."
          tint="#DCEBFF" ink="#1558BF" shade="#A9C9F2" :tilt="1.5" :delay="140"
        >
          <svg viewBox="0 0 120 120">
            <ellipse cx="58" cy="106" rx="26" ry="6" fill="#9BB7DC" />
            <line x1="60" y1="26" x2="60" y2="16" stroke="#4D8DE8" stroke-width="3" stroke-linecap="round" />
            <path class="art-sparkle" d="M60,6 Q61.6,13.4 69,15 Q61.6,16.6 60,24 Q58.4,16.6 51,15 Q58.4,13.4 60,6 Z" fill="#FFC93C" />
            <rect x="42" y="26" width="36" height="28" rx="11" fill="#A9CBFF" stroke="#4D8DE8" stroke-width="2.5" />
            <circle cx="53" cy="38" r="4" fill="#2B3A67" /><circle cx="67" cy="38" r="4" fill="#2B3A67" />
            <circle cx="54.2" cy="36.6" r="1.3" fill="#fff" /><circle cx="68.2" cy="36.6" r="1.3" fill="#fff" />
            <path d="M56,46 q4,4.5 8,0" stroke="#2B3A67" stroke-width="2.4" fill="none" stroke-linecap="round" />
            <rect x="40" y="56" width="40" height="36" rx="13" fill="#8AB6FF" stroke="#4D8DE8" stroke-width="2.5" />
            <path d="M60,69.5 c-3,-3.5 -8,-0.5 -5.5,3.5 l5.5,5 l5.5,-5 c2.5,-4 -2.5,-7 -5.5,-3.5 Z" fill="#FF6B8A" />
            <line x1="80" y1="72" x2="98" y2="56" stroke="#7A5CFF" stroke-width="4" stroke-linecap="round" />
            <path class="art-sparkle s2" d="M101,42 Q102.6,49.4 110,51 Q102.6,52.6 101,60 Q99.4,52.6 92,51 Q99.4,49.4 101,42 Z" fill="#FFC93C" />
            <circle class="art-twinkle" cx="90" cy="32" r="2.5" fill="#FF9F45" />
            <circle class="art-twinkle t2" cx="110" cy="64" r="2.5" fill="#7CC7FF" />
            <rect x="27" y="80" width="19" height="14" rx="3" fill="#FF6B8A" transform="rotate(-12 36 87)" />
            <rect x="46" y="92" width="9" height="8" rx="3" fill="#4D8DE8" />
            <rect x="65" y="92" width="9" height="8" rx="3" fill="#4D8DE8" />
          </svg>
        </PortalCard>

        <PortalCard
          to="/curriculum" title="Curriculum Builder" kid="Stack it up!" sub="Design curricula and subjects your family's way, block by block."
          tint="#D9F7EA" ink="#0B8A62" shade="#9BDCC6" :tilt="-1.5" :delay="220"
        >
          <svg viewBox="0 0 120 120">
            <ellipse cx="60" cy="106" rx="34" ry="7" fill="#A8D5B0" />
            <rect x="56" y="44" width="28" height="28" rx="6" fill="#3FA7FF" transform="rotate(6 70 58)" />
            <text x="70" y="65" class="blk-letter" transform="rotate(6 70 58)">A</text>
            <g class="art-bob">
              <rect x="38" y="42" width="28" height="28" rx="6" fill="#FFC93C" transform="rotate(-6 52 56)" />
              <text x="52" y="63" class="blk-letter" transform="rotate(-6 52 56)">B</text>
            </g>
            <rect x="26" y="72" width="28" height="28" rx="6" fill="#FF8A5C" />
            <text x="40" y="93" class="blk-letter">C</text>
            <rect x="56" y="72" width="28" height="28" rx="6" fill="#9B7BFF" />
            <text x="70" y="93" class="blk-letter">★</text>
          </svg>
        </PortalCard>

        <PortalCard
          to="/planner" title="Weekly Planner" kid="Drag, drop, done!" sub="Plan the week on a drag-drop calendar you can run with one hand."
          tint="#E1F6D9" ink="#317822" shade="#AFE0A0" :tilt="2" :delay="300"
        >
          <svg viewBox="0 0 120 120">
            <g class="art-flame">
              <path d="M53,74 Q60,96 60,96 Q60,96 67,74 Z" fill="#FFB347" />
              <path d="M56,74 Q60,88 60,88 Q60,88 64,74 Z" fill="#FFE08A" />
            </g>
            <path d="M48,56 L34,78 L50,72 Z" fill="#FF6B8A" />
            <path d="M72,56 L86,78 L70,72 Z" fill="#FF6B8A" />
            <path d="M60,18 C74,30 77,50 71,72 L49,72 C43,50 46,30 60,18 Z" fill="#F4F7FF" stroke="#B9C8E8" stroke-width="2.5" />
            <path d="M60,18 C68,25 72.5,34 74,42 L46,42 C47.5,34 52,25 60,18 Z" fill="#FF6B8A" />
            <circle cx="60" cy="54" r="9" fill="#8ED8FF" stroke="#fff" stroke-width="3" />
            <g fill="#fff" opacity="0.92">
              <circle v-for="i in 7" :key="i" :cx="27 + (i - 1) * 12" cy="102" r="4" />
            </g>
            <text x="39" y="97" class="day-star">★</text>
          </svg>
        </PortalCard>

        <PortalCard
          to="/dashboard" title="Activity Player" kid="Tap & play!" sub="Parent view for instructions, child view for content — on any device."
          tint="#FFF3CE" ink="#B8770B" shade="#F0D48A" :tilt="-2.5" :delay="380"
        >
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="ps-screen" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#A259FF" />
                <stop offset="1" stop-color="#FF5FA2" />
              </linearGradient>
            </defs>
            <path class="art-sparkle" d="M100,16 Q101.3,22 107,23.3 Q101.3,24.6 100,30.6 Q98.7,24.6 93,23.3 Q98.7,22 100,16 Z" fill="#FF9F45" />
            <path class="art-twinkle" d="M20,24 Q21,29 26,30 Q21,31 20,36 Q19,31 14,30 Q19,29 20,24 Z" fill="#FFC93C" />
            <g fill="#A259FF">
              <circle cx="24" cy="88" r="4" />
              <rect x="26.5" y="72" width="2.5" height="16" rx="1.2" />
              <path d="M29,72 q6,2 6,7 q-2,-3.5 -6,-3 Z" />
            </g>
            <rect x="28" y="42" width="64" height="46" rx="11" fill="#5B4470" />
            <rect x="34" y="48" width="52" height="34" rx="7" fill="url(#ps-screen)" />
            <path class="art-pulse" d="M56,56 L56,74 L72,65 Z" fill="#fff" />
            <rect x="52" y="88" width="16" height="7" fill="#5B4470" />
            <rect x="42" y="95" width="36" height="5" rx="2.5" fill="#5B4470" />
          </svg>
        </PortalCard>

        <PortalCard
          to="/explore" title="Games Arcade" kid="Pick a world!" sub="Explore worlds, the Phonics Playground, and Wikido's story globes."
          tint="#FFE3DC" ink="#D63C1E" shade="#F5B09A" :tilt="1.8" :delay="460"
        >
          <svg viewBox="0 0 120 120">
            <rect x="32" y="24" width="56" height="70" rx="11" fill="#FF8A5C" stroke="#E4653C" stroke-width="2.5" />
            <rect x="32" y="24" width="56" height="12" rx="6" fill="#FFD1BF" />
            <rect x="39" y="42" width="28" height="36" rx="6" fill="#CFEFF7" stroke="#fff" stroke-width="2.5" />
            <path class="art-claw" d="M53,42 L53,52 M53,52 L48,58 M53,52 L58,58" stroke="#7A4A35" stroke-width="2.5" fill="none" stroke-linecap="round" />
            <g class="art-bob">
              <path d="M53,62 Q54.3,68 60,69.3 Q54.3,70.6 53,76.6 Q51.7,70.6 46,69.3 Q51.7,68 53,62 Z" fill="#FFC93C" stroke="#E8A80C" stroke-width="1.5" />
            </g>
            <rect x="71" y="46" width="12" height="16" rx="3.5" fill="#FFE3D6" stroke="#E4653C" stroke-width="1.5" />
            <circle cx="74" cy="72" r="4.5" fill="#3EC28F" />
            <circle cx="74" cy="83" r="4.5" fill="#3FA7FF" />
            <line x1="84" y1="24" x2="84" y2="17" stroke="#7A4A35" stroke-width="3" stroke-linecap="round" />
            <circle cx="84" cy="14" r="5" fill="#D63C1E" />
            <rect x="39" y="82" width="10" height="4" rx="2" fill="#7A4A35" />
            <rect x="38" y="94" width="10" height="7" rx="2.5" fill="#E4653C" />
            <rect x="72" y="94" width="10" height="7" rx="2.5" fill="#E4653C" />
          </svg>
        </PortalCard>
      </div>

      <p class="parent-hint">
        <span class="material-symbols-rounded">supervisor_account</span>
        Parents — run the household from the
        <RouterLink to="/dashboard">Dashboard</RouterLink>
      </p>
    </div>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  min-height: calc(100vh - 62px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(180deg, var(--sky-a), var(--sky-b));
}

/* ── Hero ─────────────────────────────────────────────────────────────── */
.hero {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(1.5rem, 4vw, 3.5rem);
  padding: clamp(2rem, 5vh, 3.5rem) 1.2rem 1rem;
}
.hero-owl { align-self: flex-end; margin-bottom: clamp(0rem, 8vh, 4rem); }

.hero-copy {
  max-width: 620px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.7rem;
}

.brand {
  margin: 0;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
}
.ltr {
  display: inline-block;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 800;
  font-size: clamp(2.35rem, 6.4vw, 4.4rem);
  color: var(--c);
  -webkit-text-stroke: 9px #fff;
  paint-order: stroke fill;
  filter: drop-shadow(0 6px 0 rgba(59, 7, 100, 0.16));
  animation: ltr-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: calc(var(--i) * 45ms);
}
.ltr:hover { animation: ltr-wiggle 0.45s ease-in-out; }
@keyframes ltr-in {
  from { transform: translateY(-46px) scale(0.3) rotate(-10deg); opacity: 0; }
  70% { transform: translateY(5px) scale(1.08) rotate(3deg); opacity: 1; }
  to { transform: none; opacity: 1; }
}
@keyframes ltr-wiggle {
  25% { transform: rotate(-7deg) scale(1.1); }
  75% { transform: rotate(7deg) scale(1.1); }
}
.os-chip {
  display: inline-block;
  vertical-align: 0.9em;
  margin-left: 0.45rem;
  background: linear-gradient(135deg, #9333EA, #C026D3);
  color: #fff;
  font-family: system-ui, sans-serif;
  font-weight: 700;
  font-size: clamp(0.8rem, 1.6vw, 1.05rem);
  padding: 0.18rem 0.6rem;
  border-radius: 12px;
  box-shadow: 0 4px 0 rgba(59, 7, 100, 0.22);
}

.kid-tag {
  margin: 0.4rem 0 0;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 700;
  font-size: clamp(1.05rem, 2.4vw, 1.4rem);
  color: #fff;
  text-shadow: 0 2px 0 rgba(80, 30, 120, 0.28), 0 4px 14px rgba(80, 30, 120, 0.22);
}
.kid-tag b { color: #FFE066; }

.parent-lede {
  margin: 0;
  max-width: 540px;
  font-size: 0.95rem;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.97);
  text-shadow: 0 1px 0 rgba(80, 30, 120, 0.3), 0 3px 10px rgba(80, 30, 120, 0.25);
}

.cta-row {
  margin-top: 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  justify-content: center;
}
.btn-candy {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: linear-gradient(180deg, #FF9F45, #FF6D3B);
  color: #fff;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 700;
  font-size: 1.28rem;
  padding: 0.75rem 1.9rem;
  border-radius: 999px;
  border: 4px solid #fff;
  text-decoration: none;
  box-shadow: 0 8px 0 #D14D2A, 0 20px 28px rgba(255, 109, 59, 0.35);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
}
.btn-candy .material-symbols-rounded { font-size: 24px; }
.btn-candy:hover { transform: translateY(-3px); box-shadow: 0 11px 0 #D14D2A, 0 26px 34px rgba(255, 109, 59, 0.4); }
.btn-candy:active { transform: translateY(4px); box-shadow: 0 3px 0 #D14D2A, 0 8px 14px rgba(255, 109, 59, 0.3); }

.btn-peek {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(255, 255, 255, 0.78);
  color: #7C3AED;
  font-weight: 700;
  font-size: 0.95rem;
  padding: 0.6rem 1.15rem;
  border-radius: 999px;
  border: 3px solid #fff;
  text-decoration: none;
  backdrop-filter: blur(6px);
  transition: background 0.2s, transform 0.2s;
}
.btn-peek .material-symbols-rounded { font-size: 20px; }
.btn-peek:hover { background: #fff; transform: translateY(-2px); }

/* ── World sheet ──────────────────────────────────────────────────────── */
.world {
  position: relative;
  z-index: 1;
  margin-top: 1rem;
  padding: 1.9rem clamp(1rem, 4vw, 3rem) 2.4rem;
  background: rgba(255, 255, 255, 0.34);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 4px solid rgba(255, 255, 255, 0.55);
  border-bottom: none;
  border-radius: 46px 46px 0 0;
  box-shadow: 0 -18px 44px rgba(80, 30, 120, 0.14);
}
.world-title {
  margin: 0 0 1.3rem;
  text-align: center;
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 800;
  font-size: clamp(1.5rem, 3.4vw, 2rem);
  color: #fff;
  text-shadow: 0 3px 0 rgba(80, 30, 120, 0.28), 0 6px 16px rgba(80, 30, 120, 0.2);
}
.world-title::before { content: "✦ "; color: #FFE066; }
.world-title::after { content: " ✦"; color: #FFE066; }

.portal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(172px, 1fr));
  gap: clamp(0.9rem, 2vw, 1.4rem);
  max-width: 1240px;
  margin: 0 auto;
}

.parent-hint {
  margin: 1.7rem auto 0;
  text-align: center;
  color: #fff;
  font-size: 0.92rem;
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(80, 30, 120, 0.3);
}
.parent-hint .material-symbols-rounded { font-size: 19px; vertical-align: -5px; margin-right: 0.2rem; }
.parent-hint a { color: #fff; text-decoration-color: #FFE066; text-underline-offset: 3px; }
.parent-hint a:hover { color: #FFE066; }

/* ── Portal art animations (slot art is compiled in this scope) ───────── */
.art-sparkle, .art-twinkle, .art-claw, .art-bob, .art-beam, .art-flame, .art-pulse, .art-glow {
  transform-box: fill-box;
  transform-origin: center;
}
.art-sparkle, .art-twinkle { animation: art-twinkle 2.2s ease-in-out infinite; }
.art-sparkle.s2, .art-twinkle.t2 { animation-delay: 0.7s; }
.art-claw { transform-origin: top center; animation: art-claw-swing 2.8s ease-in-out infinite alternate; }
.art-bob { animation: art-bob 2.6s ease-in-out infinite alternate; }
.art-beam { transform-origin: 0% 50%; animation: art-beam 4.5s ease-in-out infinite alternate; }
.art-flame { transform-origin: top center; animation: art-flicker 0.34s ease-in-out infinite alternate; }
.art-pulse { animation: art-pulse 1.6s ease-in-out infinite; }
.art-glow { animation: art-glow 3s ease-in-out infinite; }
.blk-letter {
  font-family: "Baloo 2", system-ui, sans-serif;
  font-weight: 800;
  font-size: 17px;
  fill: #fff;
  text-anchor: middle;
}
.day-star { font-size: 12px; fill: #FF9F45; text-anchor: middle; }

@keyframes art-twinkle { 0%, 100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes art-claw-swing { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
@keyframes art-bob { from { transform: translateY(-2.5px); } to { transform: translateY(2.5px); } }
@keyframes art-beam { from { transform: rotate(-16deg); } to { transform: rotate(16deg); } }
@keyframes art-flicker { from { transform: scaleY(0.82); } to { transform: scaleY(1.08); } }
@keyframes art-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.16); } }
@keyframes art-glow { 0%, 100% { opacity: 0.28; } 50% { opacity: 0.6; } }

/* ── Responsive ───────────────────────────────────────────────────────── */
/* Tablet band: the world sheet would otherwise squeeze the hero row so hard
   that the owl's speech bubble slides under the sticky nav — give the hero
   its own floor and the owl a slightly smaller body. */
@media (min-width: 861px) and (max-width: 1279px) {
  .hero { min-height: 440px; }
  .hero .hero-owl { width: 200px; }
}
@media (max-width: 860px) {
  .hero { flex-direction: column; gap: 0.4rem; text-align: center; padding-top: 4.6rem; }
  .hero-owl { width: 172px; align-self: center; margin-bottom: 0; }
  .hero-copy { max-width: 92vw; }
  .brand { white-space: normal; }
}
@media (max-width: 560px) {
  .portal-grid { grid-template-columns: repeat(2, 1fr); }
  .hero-owl { width: 148px; }
}

@media (prefers-reduced-motion: reduce) {
  .ltr, .btn-candy, .btn-peek, .art-sparkle, .art-twinkle, .art-claw, .art-bob, .art-beam, .art-flame, .art-pulse, .art-glow {
    animation: none !important;
    transition: none !important;
  }
  .ltr { filter: none; }
}
</style>
