<script setup>
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <section class="home">
    <div class="hero">
      <div class="hero-icon">
        <span class="material-symbols-rounded">auto_stories</span>
      </div>
      <h1>Dar-al-Hikmah OS</h1>
      <p class="lede">
        A homeschooling operations hub — guiding-light–driven curriculum, an
        AI-built 6-month syllabus, a drag-drop weekly planner, and a dual-view
        activity player for parents and children.
      </p>
      <RouterLink v-if="!auth.user" class="btn-hero" to="/login">
        <span class="material-symbols-rounded">rocket_launch</span>
        Get started
      </RouterLink>
      <RouterLink v-else class="btn-hero" to="/dashboard">
        <span class="material-symbols-rounded">grid_view</span>
        Go to dashboard
      </RouterLink>
    </div>

    <div class="features">
      <div class="feat feat-pink">
        <span class="material-symbols-rounded feat-icon">psychology</span>
        <strong>Guiding light</strong>
        <p>Every curriculum decision is grounded in your family's values.</p>
      </div>
      <div class="feat feat-blue">
        <span class="material-symbols-rounded feat-icon">menu_book</span>
        <strong>AI curriculum</strong>
        <p>Chat with an AI agent to build a 6-month learning plan.</p>
      </div>
      <div class="feat feat-mint">
        <span class="material-symbols-rounded feat-icon">calendar_month</span>
        <strong>Weekly planner</strong>
        <p>Drag activities into a weekly calendar with one hand.</p>
      </div>
      <div class="feat feat-yellow">
        <span class="material-symbols-rounded feat-icon">play_circle</span>
        <strong>Activity player</strong>
        <p>Parent view for instructions, child view for content — on any device.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home { max-width: 680px; }

.hero {
  text-align: center;
  padding: 2.5rem 1rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.hero-icon {
  width: 72px; height: 72px;
  border-radius: 20px;
  background: linear-gradient(135deg, #9333EA, #C026D3);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 20px rgba(147,51,234,.3);
}
.hero-icon .material-symbols-rounded { font-size: 40px; color: #fff; }

h1 {
  font-size: 2rem;
  margin: 0;
  background: linear-gradient(135deg, #7C3AED, #C026D3);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.lede { color: #6B7280; line-height: 1.6; margin: 0; max-width: 480px; }

.btn-hero {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: linear-gradient(135deg, #9333EA, #C026D3);
  color: #fff;
  padding: 0.7rem 1.5rem;
  border-radius: 12px;
  text-decoration: none;
  font-weight: 600;
  font-size: 1rem;
  box-shadow: 0 4px 14px rgba(147,51,234,.3);
  transition: filter .15s;
}
.btn-hero:hover { filter: brightness(1.1); }
.btn-hero .material-symbols-rounded { font-size: 20px; }

.features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin-top: 0.5rem;
}

.feat {
  padding: 1.1rem 1.25rem;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.feat strong { font-size: 0.95rem; }
.feat p { margin: 0; font-size: 0.82rem; line-height: 1.5; opacity: .85; }
.feat-icon { font-size: 26px; margin-bottom: 0.15rem; }

.feat-pink   { background: #FBCFE8; color: #9D174D; }
.feat-blue   { background: #BFDBFE; color: #1E40AF; }
.feat-mint   { background: #BBF7D0; color: #065F46; }
.feat-yellow { background: #FEF08A; color: #854D0E; }
</style>
