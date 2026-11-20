<template>
  <div class="games-page">
    <!-- floating pastel bubbles behind everything -->
    <div class="bubbles" aria-hidden="true">
      <span v-for="n in 10" :key="n" class="bubble" :class="'b' + n"></span>
    </div>

    <header class="hero">
      <h1 class="title">
        <span class="wiggle">🎮</span>
        Games
      </h1>
      <p class="sub">Pick a game and start playing!</p>
    </header>

    <div class="grid">
      <!-- EXPLORE — rocket -->
      <RouterLink to="/explore" class="card c-explore" :style="{ animationDelay: '.05s' }">
        <div class="art">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <circle class="tw" cx="18" cy="16" r="2.4" fill="#FCD34D"/>
            <circle class="tw d2" cx="104" cy="24" r="2" fill="#F9A8D4"/>
            <circle class="tw d3" cx="98" cy="10" r="1.6" fill="#93C5FD"/>
            <circle class="tw d4" cx="12" cy="70" r="1.8" fill="#A7F3D0"/>
            <g class="bob">
              <path d="M60 10 C73 27 73 52 60 68 C47 52 47 27 60 10 Z" fill="#FB923C" stroke="#9A3412" stroke-width="2.5" stroke-linejoin="round"/>
              <circle cx="60" cy="40" r="7.5" fill="#BAE6FD" stroke="#9A3412" stroke-width="2.5"/>
              <path d="M47 44 L37 57 L51 54 Z" fill="#F87171" stroke="#9A3412" stroke-width="2" stroke-linejoin="round"/>
              <path d="M73 44 L83 57 L69 54 Z" fill="#F87171" stroke="#9A3412" stroke-width="2" stroke-linejoin="round"/>
              <path class="flame" d="M60 70 C56 76 56 82 60 88 C64 82 64 76 60 70 Z" fill="#FDBA74"/>
            </g>
          </svg>
        </div>
        <h2>Explore</h2>
        <p>Blast off and chat with a starry friend!</p>
        <span class="play pill-peach">Play<span class="material-symbols-rounded">arrow_forward</span></span>
      </RouterLink>

      <!-- WIKIDO — globe + magnifier -->
      <RouterLink to="/wikido" class="card c-wikido" :style="{ animationDelay: '.15s' }">
        <div class="art">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <g class="bob d2">
              <circle cx="52" cy="42" r="26" fill="#FEF08A" stroke="#854D0E" stroke-width="2.5"/>
              <ellipse cx="52" cy="42" rx="11" ry="26" fill="none" stroke="#854D0E" stroke-width="1.6" opacity=".55"/>
              <line x1="26" y1="42" x2="78" y2="42" stroke="#854D0E" stroke-width="1.6" opacity=".55"/>
              <path d="M30 31 h44 M30 53 h44" stroke="#854D0E" opacity=".35" stroke-width="1.4" fill="none"/>
              <circle cx="84" cy="60" r="13" fill="none" stroke="#7C3AED" stroke-width="5"/>
              <line x1="94" y1="70" x2="105" y2="81" stroke="#7C3AED" stroke-width="6" stroke-linecap="round"/>
            </g>
            <circle class="tw" cx="102" cy="18" r="2.2" fill="#FCD34D"/>
            <circle class="tw d2" cx="14" cy="62" r="2" fill="#F9A8D4"/>
          </svg>
        </div>
        <h2>Wikido</h2>
        <p>Explore a world of pictures and facts!</p>
        <span class="play pill-yellow">Play<span class="material-symbols-rounded">arrow_forward</span></span>
      </RouterLink>

      <!-- PHONICS — bouncing letters -->
      <RouterLink to="/phonics" class="card c-phonics" :style="{ animationDelay: '.25s' }">
        <div class="art">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <path class="wave" d="M12 20 q6 -9 12 0" stroke="#10B981" fill="none" stroke-width="3" stroke-linecap="round"/>
            <path class="wave d2" d="M96 14 q6 -9 12 0" stroke="#34D399" fill="none" stroke-width="3" stroke-linecap="round"/>
            <g class="hover-float">
              <text x="18" y="60" class="lt" fill="#059669">a</text>
              <text x="50" y="60" class="lt d2" fill="#0D9488">b</text>
              <text x="82" y="60" class="lt d3" fill="#10B981">c</text>
            </g>
            <circle class="tw" cx="106" cy="68" r="2.2" fill="#FCD34D"/>
            <circle class="tw d3" cx="22" cy="74" r="1.8" fill="#93C5FD"/>
          </svg>
        </div>
        <h2>Phonics</h2>
        <p>Play with sounds and letters!</p>
        <span class="play pill-mint">Play<span class="material-symbols-rounded">arrow_forward</span></span>
      </RouterLink>

      <!-- MATH GAMES — ruler + snappy scissors -->
      <a href="/games/math/index.html?from=/games" class="card c-math" :style="{ animationDelay: '.35s' }">
        <div class="art">
          <svg viewBox="0 0 120 90" aria-hidden="true">
            <g class="hover-float">
              <rect x="14" y="48" width="92" height="24" rx="5" fill="#FDE68A" stroke="#B45309" stroke-width="2.5"/>
              <path d="M26 48 v8 M38 48 v8 M50 48 v8 M62 48 v8 M74 48 v8 M86 48 v8 M98 48 v8" stroke="#B45309" stroke-width="2" fill="none"/>
              <line class="cutline" x1="62" y1="44" x2="62" y2="76" stroke="#EF4444" stroke-width="3" stroke-dasharray="6 5"/>
              <g class="snip">
                <circle cx="54" cy="30" r="6" fill="none" stroke="#334155" stroke-width="3.5"/>
                <circle cx="70" cy="30" r="6" fill="none" stroke="#334155" stroke-width="3.5"/>
                <path d="M58 34 L72 16 M66 34 L52 16" stroke="#334155" stroke-width="3.5" stroke-linecap="round"/>
              </g>
            </g>
            <circle class="tw d2" cx="12" cy="22" r="2" fill="#93C5FD"/>
            <circle class="tw" cx="108" cy="76" r="2.2" fill="#FCD34D"/>
          </svg>
        </div>
        <h2>Math Games</h2>
        <p>Cut rulers and play with numbers!</p>
        <span class="play pill-sky">Play<span class="material-symbols-rounded">arrow_forward</span></span>
      </a>
    </div>

    <p class="foot">more games are on their way! 💛</p>
  </div>
</template>

<script setup>
// Pure listing page — every card is a plain link, no logic to test.
</script>

<style scoped>
.games-page {
  position: relative;
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  overflow: hidden;
}

/* ---------- floating bubbles ---------- */
.bubbles { position: absolute; inset: 0; pointer-events: none; }
.bubble {
  position: absolute;
  bottom: -60px;
  width: 22px; height: 22px;
  border-radius: 50%;
  opacity: .5;
  animation: rise 14s linear infinite;
}
.bubble.b1 { left: 4%;  background: #FBCFE8; animation-delay: 0s; }
.bubble.b2 { left: 14%; background: #FDE68A; animation-delay: -3s; width: 14px; height: 14px; }
.bubble.b3 { left: 26%; background: #BBF7D0; animation-delay: -6s; }
.bubble.b4 { left: 38%; background: #BAE6FD; animation-delay: -9s; width: 16px; height: 16px; }
.bubble.b5 { left: 52%; background: #DDD6FE; animation-delay: -1.5s; width: 26px; height: 26px; }
.bubble.b6 { left: 64%; background: #FBCFE8; animation-delay: -5s; width: 12px; height: 12px; }
.bubble.b7 { left: 74%; background: #FED7AA; animation-delay: -8s; }
.bubble.b8 { left: 84%; background: #99F6E4; animation-delay: -11s; width: 18px; height: 18px; }
.bubble.b9 { left: 92%; background: #FDE68A; animation-delay: -4s; width: 15px; height: 15px; }
.bubble.b10 { left: 47%; background: #BFDBFE; animation-delay: -12s; }
@keyframes rise {
  from { transform: translateY(0) rotate(0deg); }
  to   { transform: translateY(-110vh) rotate(320deg); }
}

/* ---------- hero ---------- */
.hero { position: relative; text-align: center; z-index: 1; }
.title {
  margin: 0;
  font-size: clamp(2.2rem, 6vw, 3.2rem);
  font-weight: 800;
  letter-spacing: .01em;
  background: linear-gradient(120deg, #7C3AED, #C026D3, #EA580C);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wiggle { display: inline-block; animation: wiggle 2.4s ease-in-out infinite; }
@keyframes wiggle {
  0%, 100% { transform: rotate(-8deg) scale(1); }
  50% { transform: rotate(8deg) scale(1.15); }
}
.sub {
  margin: .3rem 0 0;
  font-size: 1.05rem;
  color: #EA580C;
  font-weight: 600;
}

/* ---------- card grid ---------- */
.grid {
  position: relative;
  z-index: 1;
  margin-top: 1.8rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
  gap: 1.1rem;
}
@media (min-width: 760px) { .grid { grid-template-columns: repeat(4, 1fr); } }

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .3rem;
  padding: 1.2rem .9rem 1.1rem;
  border-radius: 26px;
  text-decoration: none;
  color: inherit;
  border: 3px solid #fff;
  box-shadow: 0 10px 26px rgba(147, 51, 234, .13);
  animation: pop .55s cubic-bezier(.2, 1.4, .4, 1) both;
  transition: transform .16s, box-shadow .16s;
}
.card:hover { transform: translateY(-7px) rotate(-1.2deg); box-shadow: 0 18px 36px rgba(147, 51, 234, .22); }
.card:active { transform: scale(.95); }
@keyframes pop {
  from { transform: translateY(28px) scale(.8); opacity: 0; }
}

.c-explore { background: linear-gradient(180deg, #FFF7ED, #FFEDD5); }
.c-wikido  { background: linear-gradient(180deg, #FEFCE8, #FEF9C3); }
.c-phonics { background: linear-gradient(180deg, #F0FDF4, #D1FAE5); }
.c-math    { background: linear-gradient(180deg, #F0F9FF, #E0F2FE); }

.card h2 { margin: .4rem 0 0; font-size: 1.25rem; font-weight: 700; color: #3a2e39; }
.card p { margin: 0 0 .5rem; font-size: .87rem; color: #6B7280; text-align: center; line-height: 1.3; min-height: 2.2em; }

.art { width: 118px; height: 88px; }
.art svg { width: 100%; height: 100%; overflow: visible; }
.card:hover .hover-float, .bob { animation: bob 3s ease-in-out infinite; }
.card:hover .hover-float { animation-duration: 1.1s; }
.bob.d2 { animation-delay: .6s; }
@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

.flame { animation: flicker .5s ease-in-out infinite alternate; transform-origin: 60px 70px; }
@keyframes flicker { from { transform: scaleY(.7); } to { transform: scaleY(1.15); } }

.tw { animation: twinkle 1.8s ease-in-out infinite; }
.tw.d2 { animation-delay: .5s; }
.tw.d3 { animation-delay: 1s; }
.tw.d4 { animation-delay: 1.4s; }
@keyframes twinkle { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }

.wave { animation: wave 1.6s ease-in-out infinite; }
.wave.d2 { animation-delay: .7s; }
@keyframes wave { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }

.lt { font: 800 36px ui-rounded, "Segoe UI", system-ui, sans-serif; }
.lt.d2 { animation: bounce 1.6s ease-in-out infinite; animation-delay: .25s; }
.lt.d3 { animation: bounce 1.6s ease-in-out infinite; animation-delay: .5s; }
.lt { animation: bounce 1.6s ease-in-out infinite; }
@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

.cutline { animation: march .7s linear infinite; }
@keyframes march { to { stroke-dashoffset: -11; } }
.snip { transform-origin: 62px 25px; animation: snips 1.4s ease-in-out infinite; }
@keyframes snips { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }

.play {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: .2rem;
  font-weight: 700;
  font-size: .85rem;
  padding: .45rem 1.1rem;
  border-radius: 999px;
  color: #fff;
}
.play .material-symbols-rounded { font-size: 16px; }
.pill-peach  { background: #F97316; box-shadow: 0 3px 0 #C2410C; }
.pill-yellow { background: #CA8A04; box-shadow: 0 3px 0 #A16207; }
.pill-mint   { background: #10B981; box-shadow: 0 3px 0 #047857; }
.pill-sky    { background: #0EA5E9; box-shadow: 0 3px 0 #0369A1; }
.card:hover .play { animation: nudge .5s ease-in-out infinite; }
@keyframes nudge { 50% { transform: translateX(3px); } }

.foot { position: relative; z-index: 1; text-align: center; margin-top: 1.8rem; color: #A78BFA; font-weight: 600; }
</style>
