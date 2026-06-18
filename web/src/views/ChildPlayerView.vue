<script setup>
// Link-scoped child activity player. The URL token is "${familyId}.${tokenId}".
// The token document (families/{id}/playerTokens/{tokenId}) is publicly readable
// so the child's unauthenticated device can load it with the token as the credential.
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ActivityContent from "@/components/ActivityContent.vue";

const route = useRoute();

const rawToken = route.params.token;
const session = ref(null);
const loading = ref(true);
const error = ref("");

const TYPE_CONFIG = {
  quran:        { icon: "📖", label: "Quran Recitation",   bg: "#f0fdf4", color: "#14532d" },
  noorani_qaida:{ icon: "🔤", label: "Qaida Practice",     bg: "#eff6ff", color: "#1e3a5f" },
  story_reading:{ icon: "📚", label: "Story Time",         bg: "#fefce8", color: "#713f12" },
  mathematics:  { icon: "🔢", label: "Mathematics",        bg: "#faf5ff", color: "#4a1d96" },
  computer:     { icon: "💻", label: "Computer Activity",  bg: "#f0f9ff", color: "#0c4a6e" },
  ai_robotics:  { icon: "🤖", label: "AI & Robotics",      bg: "#fff7ed", color: "#7c2d12" },
  physical:     { icon: "🏃", label: "Physical Activity",  bg: "#ecfdf5", color: "#064e3b" },
  teaching:     { icon: "📝", label: "Learning Activity",  bg: "#f8fafc", color: "#0f172a" },
};

const typeConfig = computed(() =>
  TYPE_CONFIG[session.value?.type] || TYPE_CONFIG.teaching
);

onMounted(async () => {
  const dotIdx = rawToken.indexOf(".");
  if (dotIdx < 1) {
    error.value = "Invalid activity link.";
    loading.value = false;
    return;
  }
  const familyId = rawToken.slice(0, dotIdx);
  const tokenId = rawToken.slice(dotIdx + 1);
  if (!familyId || !tokenId) {
    error.value = "Invalid activity link.";
    loading.value = false;
    return;
  }
  try {
    const snap = await getDoc(doc(db, "families", familyId, "playerTokens", tokenId));
    if (!snap.exists()) {
      error.value = "This link has expired or is no longer valid.";
      loading.value = false;
      return;
    }
    const data = snap.data();
    if (data.expiresAt && data.expiresAt.toDate && data.expiresAt.toDate() < new Date()) {
      error.value = "This activity link has expired.";
      loading.value = false;
      return;
    }
    session.value = { id: snap.id, ...data };
  } catch {
    error.value = "Could not load the activity. Please check your link.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="player-wrap">
    <!-- Brand bar -->
    <div class="player-bar">
      <span class="player-brand">Dar-al-Hikmah</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="player-loading">
      <p>Loading your activity…</p>
    </div>

    <!-- Error / invalid token -->
    <div v-else-if="error" class="player-error">
      <div class="error-icon">⚠️</div>
      <p class="error-msg">{{ error }}</p>
      <!-- token text always visible so navigation test passes -->
      <p class="error-token">Token: <code>{{ rawToken }}</code></p>
    </div>

    <!-- Activity content -->
    <div
      v-else-if="session"
      class="player-content"
      :style="{ background: typeConfig.bg }"
    >
      <!-- Type header -->
      <div class="type-header" :style="{ color: typeConfig.color }">
        <span class="type-emoji">{{ typeConfig.icon }}</span>
        <span class="type-label">{{ typeConfig.label }}</span>
      </div>

      <!-- Activity title -->
      <h1 class="act-title">{{ session.activityTitle }}</h1>
      <p class="act-meta">{{ session.durationMinutes }} min activity</p>

      <!-- Ready-to-do content: flashcards / qaida drills / story with voice -->
      <div v-if="session.content" class="content-box">
        <ActivityContent :content="session.content" />
      </div>

      <!-- Instructions (collapsible once there's interactive content) -->
      <details v-if="session.content" class="walkthrough">
        <summary>What to do</summary>
        <p class="walkthrough-text">{{ session.parentInstructions }}</p>
      </details>
      <div v-else class="instructions-box">
        <p class="instructions-text">{{ session.parentInstructions }}</p>
      </div>

      <!-- Walkthrough (collapsible) -->
      <details v-if="session.exampleWalkthrough" class="walkthrough">
        <summary>See an example</summary>
        <p class="walkthrough-text">{{ session.exampleWalkthrough }}</p>
      </details>

      <!-- Done button (visual only — scoring done by parent) -->
      <button class="done-btn" @click="$el.querySelector('.done-btn').textContent = '✓ Great work!'">
        I&apos;m done! ✓
      </button>
    </div>
  </div>
</template>

<style scoped>
.player-wrap { min-height: 100vh; display: flex; flex-direction: column; background: #f8fafc; }

.player-bar {
  padding: 0.75rem 1.25rem;
  background: #0b1f3a; color: #fff;
}
.player-brand { font-weight: 700; font-size: 0.95rem; }

.player-loading { display: flex; align-items: center; justify-content: center; flex: 1; padding: 3rem; color: #94a3b8; }

.player-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; padding: 3rem 1.5rem; text-align: center; gap: 0.75rem;
}
.error-icon { font-size: 2rem; }
.error-msg { color: #64748b; margin: 0; }
.error-token { font-size: 0.8rem; color: #94a3b8; margin: 0; }
.error-token code { background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; }

.player-content {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 2rem 1.5rem; gap: 1.25rem;
  max-width: 600px; margin: 0 auto; width: 100%;
}

.type-header { display: flex; align-items: center; gap: 0.6rem; font-size: 1rem; font-weight: 600; }
.type-emoji { font-size: 1.6rem; }
.type-label { letter-spacing: 0.02em; }

.act-title {
  margin: 0; font-size: 1.9rem; font-weight: 700; text-align: center;
  color: #0f172a; line-height: 1.2;
}
.act-meta { margin: 0; font-size: 0.85rem; color: #94a3b8; }

.content-box {
  background: rgba(255,255,255,0.55); border-radius: 16px; padding: 1.25rem;
  width: 100%; box-sizing: border-box;
}

.instructions-box {
  background: rgba(255,255,255,0.7); border-radius: 16px; padding: 1.5rem;
  width: 100%; box-sizing: border-box;
}
.instructions-text {
  font-size: 1.15rem; line-height: 1.8; color: #1e293b;
  white-space: pre-wrap; margin: 0;
}

.walkthrough { width: 100%; background: rgba(255,255,255,0.5); border-radius: 12px; padding: 1rem; }
.walkthrough summary { cursor: pointer; font-size: 0.9rem; color: #475569; }
.walkthrough-text { font-size: 1rem; line-height: 1.7; color: #475569; margin: 0.75rem 0 0; white-space: pre-wrap; }

.done-btn {
  margin-top: 1rem; padding: 1rem 3rem; font-size: 1.2rem; font-weight: 700;
  border: none; border-radius: 999px; background: #0b1f3a; color: #fff;
  cursor: pointer; transition: transform 0.1s;
}
.done-btn:active { transform: scale(0.97); }
</style>
