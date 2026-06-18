<script setup>
import { useAuthStore } from "@/stores/auth";
import { useFamilyStore } from "@/stores/family";
import { useProfilesStore } from "@/stores/profiles";
import { RouterLink } from "vue-router";

const auth = useAuthStore();
const family = useFamilyStore();
const profiles = useProfilesStore();
</script>

<template>
  <section class="dash">
    <!-- Welcome banner -->
    <div class="banner">
      <div class="banner-left">
        <span class="material-symbols-rounded banner-icon">waving_hand</span>
        <div>
          <h1>{{ family.family?.name || "Your family" }}</h1>
          <p class="sub">
            {{ auth.user?.displayName || auth.user?.email }}
            <span class="role-badge" :class="auth.role">{{ auth.role }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Guiding light -->
    <div v-if="family.profile?.guidingLight" class="card guiding-card">
      <div class="card-head">
        <span class="material-symbols-rounded card-icon" style="color:#9D174D">psychology</span>
        <h2>Guiding light</h2>
      </div>
      <p class="guiding-text">{{ family.profile.guidingLight }}</p>
    </div>

    <!-- Quick links grid -->
    <div class="quick-grid">
      <RouterLink to="/children" class="quick-tile tile-mint">
        <span class="material-symbols-rounded">child_care</span>
        <strong>{{ profiles.children.length }} Children</strong>
      </RouterLink>
      <RouterLink to="/curriculum" class="quick-tile tile-rose">
        <span class="material-symbols-rounded">menu_book</span>
        <strong>Curriculum</strong>
      </RouterLink>
      <RouterLink to="/planner" class="quick-tile tile-peach">
        <span class="material-symbols-rounded">calendar_month</span>
        <strong>Planner</strong>
      </RouterLink>
      <RouterLink to="/syllabus" class="quick-tile tile-teal">
        <span class="material-symbols-rounded">format_list_bulleted</span>
        <strong>Syllabus</strong>
      </RouterLink>
    </div>

    <!-- Members -->
    <div class="card">
      <div class="card-head">
        <span class="material-symbols-rounded card-icon" style="color:#1E40AF">group</span>
        <h2>Members ({{ family.members.length }})</h2>
      </div>
      <ul class="members">
        <li v-for="m in family.members" :key="m.uid" class="member-row">
          <span class="material-symbols-rounded avatar-icon">account_circle</span>
          <span class="member-name">{{ m.displayName || m.email }}</span>
          <span class="role-badge" :class="m.role">{{ m.role }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 1rem; }

/* Banner */
.banner {
  background: linear-gradient(135deg, #9333EA 0%, #C026D3 100%);
  border-radius: 20px;
  padding: 1.5rem 1.75rem;
  color: #fff;
  box-shadow: 0 4px 20px rgba(147,51,234,.3);
}
.banner-left { display: flex; align-items: center; gap: 1rem; }
.banner-icon { font-size: 36px; }
h1 { margin: 0; font-size: 1.5rem; color: #fff; }
.sub { margin: 0.2rem 0 0; font-size: 0.875rem; color: rgba(255,255,255,.8); display: flex; align-items: center; gap: 0.5rem; }

/* Role badges */
.role-badge { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 0.1rem 0.5rem; border-radius: 999px; }
.role-badge.owner  { background: #DDD6FE; color: #4C1D95; }
.role-badge.parent { background: #BBF7D0; color: #065F46; }
.role-badge.viewer { background: #FEF08A; color: #854D0E; }

/* Cards */
.card { background: #fff; border: 1px solid #EDE9FE; border-radius: 16px; padding: 1.1rem 1.25rem; }
.card-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; }
.card-head h2 { margin: 0; font-size: 1rem; color: #3B0764; }
.card-icon { font-size: 22px; }

/* Guiding light */
.guiding-card { border-left: 4px solid #FBCFE8; }
.guiding-text { white-space: pre-wrap; color: #4B5563; margin: 0; line-height: 1.6; font-style: italic; }

/* Quick tiles */
.quick-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
.quick-tile {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  padding: 1.1rem 0.75rem;
  border-radius: 16px;
  text-decoration: none;
  font-size: 0.82rem;
  transition: filter .15s, transform .15s;
}
.quick-tile:hover { filter: brightness(.95); transform: translateY(-2px); }
.quick-tile .material-symbols-rounded { font-size: 28px; }
.quick-tile strong { text-align: center; }
.tile-mint  { background: #BBF7D0; color: #065F46; }
.tile-rose  { background: #FECDD3; color: #9F1239; }
.tile-peach { background: #FED7AA; color: #9A3412; }
.tile-teal  { background: #99F6E4; color: #134E4A; }

/* Members */
.members { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.member-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.6rem; background: #FAFAFA; border-radius: 10px; }
.avatar-icon { font-size: 22px; color: #C4B5FD; }
.member-name { flex: 1; font-size: 0.875rem; color: #3B0764; font-weight: 500; }
</style>
