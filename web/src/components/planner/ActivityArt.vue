<script setup>
// Little flat pictures for each activity type, drawn in the games' style (flat
// fills, white highlights, round strokes) so a parent can tell "Quran" from
// "Maths" at a glance without reading the card.
defineProps({ type: { type: String, default: "teaching" } });
</script>

<template>
  <svg viewBox="0 0 64 64" class="art" aria-hidden="true">
    <!-- Quran: green mushaf on a rehal stand -->
    <g v-if="type === 'quran'">
      <path d="M10 50 L32 40 L54 50 L50 54 L32 46 L14 54 Z" fill="#C96F1E" />
      <path d="M12 16 Q22 12 32 18 V44 Q22 38 12 42 Z" fill="#1E9E5C" />
      <path d="M52 16 Q42 12 32 18 V44 Q42 38 52 42 Z" fill="#26B56C" />
      <path d="M32 18 V44" stroke="#FFE45C" stroke-width="2" />
      <circle cx="22" cy="28" r="4" fill="none" stroke="#FFE45C" stroke-width="2" />
      <circle cx="42" cy="28" r="4" fill="none" stroke="#FFE45C" stroke-width="2" />
      <ellipse cx="18" cy="19" rx="4" ry="1.8" fill="#fff" opacity=".4" />
    </g>
    <!-- Qaida: alif-ba letter blocks -->
    <g v-else-if="type === 'noorani_qaida'">
      <rect x="6" y="28" width="26" height="26" rx="6" fill="#6FE3D2" />
      <rect x="32" y="28" width="26" height="26" rx="6" fill="#FFB25A" />
      <rect x="19" y="4" width="26" height="26" rx="6" fill="#FF8FB1" />
      <path d="M19 34 V48" stroke="#fff" stroke-width="4" stroke-linecap="round" />
      <path d="M38 40 Q45 48 52 40" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" />
      <circle cx="45" cy="50" r="2.4" fill="#fff" />
      <path d="M26 14 Q32 22 38 14" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" />
      <circle cx="29" cy="24" r="2.2" fill="#fff" /><circle cx="35" cy="24" r="2.2" fill="#fff" />
    </g>
    <!-- Reading (Arabic / Urdu / English): an open book, coloured per language -->
    <g v-else-if="['arabic_reading', 'urdu_reading', 'english_reading'].includes(type)">
      <path d="M6 14 Q19 9 32 16 V52 Q19 45 6 50 Z" :fill="type === 'urdu_reading' ? '#FFB25A' : type === 'arabic_reading' ? '#7FE3A6' : '#6FD3FF'" />
      <path d="M58 14 Q45 9 32 16 V52 Q45 45 58 50 Z" fill="#fff" />
      <path d="M58 14 Q45 9 32 16 V52 Q45 45 58 50 Z" fill="none" :stroke="type === 'urdu_reading' ? '#C96F1E' : type === 'arabic_reading' ? '#1E9E5C' : '#1D7FBE'" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M38 24 H52 M38 31 H52 M38 38 H48" stroke="#C7CDD8" stroke-width="3" stroke-linecap="round" />
      <ellipse cx="14" cy="18" rx="5" ry="2" fill="#fff" opacity=".45" />
    </g>
    <!-- Story: storybook with a star -->
    <g v-else-if="type === 'story_reading'">
      <rect x="12" y="8" width="40" height="48" rx="6" fill="#C39BFF" />
      <rect x="12" y="8" width="8" height="48" rx="3" fill="#7B3FD1" />
      <path d="M36 18 L39.5 26 L48 26.5 L41.5 32 L43.5 40.5 L36 36 L28.5 40.5 L30.5 32 L24 26.5 L32.5 26 Z" fill="#FFE45C" />
      <ellipse cx="28" cy="13" rx="6" ry="2" fill="#fff" opacity=".4" />
    </g>
    <!-- Conversation: two speech bubbles -->
    <g v-else-if="type === 'conversation'">
      <path d="M6 12 Q6 6 12 6 H38 Q44 6 44 12 V28 Q44 34 38 34 H20 L12 42 V34 Q6 34 6 28 Z" fill="#FF8FB1" />
      <path d="M58 30 Q58 24 52 24 H28 Q22 24 22 30 V44 Q22 50 28 50 H44 L52 58 V50 Q58 50 58 44 Z" fill="#6FD3FF" />
      <circle cx="32" cy="37" r="2.6" fill="#fff" /><circle cx="40" cy="37" r="2.6" fill="#fff" /><circle cx="48" cy="37" r="2.6" fill="#fff" />
      <ellipse cx="16" cy="11" rx="6" ry="2" fill="#fff" opacity=".45" />
    </g>
    <!-- Maths: 1 + 2 tiles -->
    <g v-else-if="type === 'mathematics'">
      <rect x="4" y="18" width="24" height="28" rx="7" fill="#FFE45C" />
      <rect x="36" y="18" width="24" height="28" rx="7" fill="#6FD3FF" />
      <text x="16" y="40" text-anchor="middle" font-size="20" font-weight="800" fill="#A98608" font-family="'Baloo 2', system-ui">1</text>
      <text x="48" y="40" text-anchor="middle" font-size="20" font-weight="800" fill="#1D7FBE" font-family="'Baloo 2', system-ui">2</text>
      <path d="M32 28 V36 M28 32 H36" stroke="#D6457C" stroke-width="3.4" stroke-linecap="round" />
    </g>
    <!-- Computer: a smiling laptop -->
    <g v-else-if="type === 'computer'">
      <rect x="10" y="10" width="44" height="32" rx="5" fill="#1D7FBE" />
      <rect x="14" y="14" width="36" height="24" rx="3" fill="#B7E7FF" />
      <path d="M4 46 H60 L56 54 H8 Z" fill="#6FD3FF" />
      <circle cx="26" cy="23" r="2.6" fill="#1D7FBE" /><circle cx="38" cy="23" r="2.6" fill="#1D7FBE" />
      <path d="M26 30 Q32 35 38 30" stroke="#1D7FBE" stroke-width="2.6" fill="none" stroke-linecap="round" />
    </g>
    <!-- AI & robotics: a friendly robot head -->
    <g v-else-if="type === 'ai_robotics'">
      <path d="M32 4 V12" stroke="#D1502A" stroke-width="3" stroke-linecap="round" />
      <circle cx="32" cy="5" r="3.5" fill="#FFE45C" />
      <rect x="10" y="12" width="44" height="38" rx="10" fill="#FF9D7A" />
      <rect x="4" y="24" width="6" height="14" rx="3" fill="#D1502A" /><rect x="54" y="24" width="6" height="14" rx="3" fill="#D1502A" />
      <circle cx="23" cy="28" r="6" fill="#fff" /><circle cx="41" cy="28" r="6" fill="#fff" />
      <circle cx="24" cy="28" r="3" fill="#3a2b52" /><circle cx="42" cy="28" r="3" fill="#3a2b52" />
      <rect x="22" y="39" width="20" height="5" rx="2.5" fill="#fff" />
      <ellipse cx="18" cy="16" rx="5" ry="2" fill="#fff" opacity=".45" />
    </g>
    <!-- Physical: a bouncing ball with motion lines -->
    <g v-else-if="type === 'physical'">
      <path d="M6 22 H16 M4 32 H14 M6 42 H16" stroke="#C39BFF" stroke-width="3.4" stroke-linecap="round" />
      <circle cx="38" cy="32" r="20" fill="#FF9D7A" />
      <path d="M18 32 Q38 22 58 32 M38 12 Q30 32 38 52" stroke="#fff" stroke-width="3" fill="none" />
      <ellipse cx="31" cy="20" rx="6" ry="3" fill="#fff" opacity=".45" />
    </g>
    <!-- Teaching / anything else: a happy pencil -->
    <g v-else>
      <g transform="rotate(-35 32 32)">
        <rect x="14" y="24" width="32" height="16" rx="3" fill="#FFB25A" />
        <rect x="8" y="24" width="8" height="16" rx="3" fill="#FF8FB1" />
        <path d="M46 24 L58 32 L46 40 Z" fill="#FFE8C2" />
        <path d="M54 29.4 L58 32 L54 34.6 Z" fill="#3a2b52" />
        <circle cx="26" cy="30" r="1.8" fill="#7A3A00" /><circle cx="34" cy="30" r="1.8" fill="#7A3A00" />
        <path d="M27 34.5 Q30 37 33 34.5" stroke="#7A3A00" stroke-width="1.8" fill="none" stroke-linecap="round" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.art { width: 100%; height: 100%; display: block; }
</style>
