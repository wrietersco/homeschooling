<script setup>
import { RouterLink } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <header class="nav">
    <RouterLink to="/" class="brand">
      <span class="material-symbols-rounded brand-icon">auto_stories</span>
      <span class="brand-text">Dar-al-Hikmah OS</span>
    </RouterLink>

    <nav class="links">
      <RouterLink to="/" class="nav-link c-pink" exact>
        <span class="material-symbols-rounded">home</span>
        <span class="lbl">Home</span>
      </RouterLink>

      <template v-if="auth.user && auth.hasFamily">
        <RouterLink to="/dashboard" class="nav-link c-blue">
          <span class="material-symbols-rounded">grid_view</span>
          <span class="lbl">Dashboard</span>
        </RouterLink>
        <RouterLink to="/profile" class="nav-link c-lavender">
          <span class="material-symbols-rounded">family_restroom</span>
          <span class="lbl">Profile</span>
        </RouterLink>
        <RouterLink to="/guardians" class="nav-link c-peach">
          <span class="material-symbols-rounded">supervisor_account</span>
          <span class="lbl">Guardians</span>
        </RouterLink>
        <RouterLink to="/children" class="nav-link c-mint">
          <span class="material-symbols-rounded">child_care</span>
          <span class="lbl">Children</span>
        </RouterLink>
        <RouterLink to="/skills" class="nav-link c-yellow">
          <span class="material-symbols-rounded">school</span>
          <span class="lbl">Skills</span>
        </RouterLink>
        <RouterLink to="/guide" class="nav-link c-sky">
          <span class="material-symbols-rounded">chat_bubble</span>
          <span class="lbl">Guide</span>
        </RouterLink>
        <RouterLink to="/curriculum" class="nav-link c-rose">
          <span class="material-symbols-rounded">menu_book</span>
          <span class="lbl">Curriculum</span>
        </RouterLink>
        <RouterLink to="/syllabus" class="nav-link c-teal">
          <span class="material-symbols-rounded">format_list_bulleted</span>
          <span class="lbl">Syllabus</span>
        </RouterLink>
        <RouterLink to="/planner" class="nav-link c-peach">
          <span class="material-symbols-rounded">calendar_month</span>
          <span class="lbl">Planner</span>
        </RouterLink>
        <RouterLink to="/session" class="nav-link c-mint">
          <span class="material-symbols-rounded">play_circle</span>
          <span class="lbl">Play</span>
        </RouterLink>
      </template>

      <RouterLink v-if="auth.isSuperAdmin" to="/platform" class="nav-link c-rose">
        <span class="material-symbols-rounded">admin_panel_settings</span>
        <span class="lbl">Platform</span>
      </RouterLink>

      <RouterLink v-if="!auth.user" to="/login" class="nav-link c-lavender">
        <span class="material-symbols-rounded">login</span>
        <span class="lbl">Sign in</span>
      </RouterLink>
      <button v-else class="nav-link nav-signout" type="button" @click="auth.logout()">
        <span class="material-symbols-rounded">logout</span>
        <span class="lbl">Sign out</span>
      </button>
    </nav>
  </header>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1.25rem;
  background: #fff;
  border-bottom: 1px solid #F3E8FF;
  box-shadow: 0 1px 16px rgba(147, 51, 234, .07);
  background-image: linear-gradient(#fff, #fff),
    linear-gradient(to right, #FBCFE8, #FED7AA, #FEF08A, #BBF7D0, #BAE6FD, #DDD6FE, #FECDD3);
  background-size: 100% calc(100% - 3px), 100% 3px;
  background-position: top, bottom;
  background-repeat: no-repeat;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  text-decoration: none;
  flex-shrink: 0;
}
.brand-icon {
  font-size: 26px;
  background: linear-gradient(135deg, #9333EA, #C026D3);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.brand-text {
  font-weight: 700;
  font-size: 0.95rem;
  background: linear-gradient(135deg, #7C3AED, #C026D3);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 0.01em;
}

.links {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  overflow-x: auto;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.32rem 0.55rem;
  border-radius: 10px;
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background .15s, color .15s;
}
.nav-link .material-symbols-rounded { font-size: 17px; }
.nav-link:hover { background: #F5F3FF; color: #7C3AED; }

.nav-link.c-pink.router-link-active     { background: #FBCFE8; color: #9D174D; }
.nav-link.c-blue.router-link-active     { background: #BFDBFE; color: #1E40AF; }
.nav-link.c-lavender.router-link-active { background: #DDD6FE; color: #4C1D95; }
.nav-link.c-peach.router-link-active    { background: #FED7AA; color: #9A3412; }
.nav-link.c-mint.router-link-active     { background: #BBF7D0; color: #065F46; }
.nav-link.c-yellow.router-link-active   { background: #FEF08A; color: #854D0E; }
.nav-link.c-sky.router-link-active      { background: #BAE6FD; color: #0C4A6E; }
.nav-link.c-rose.router-link-active     { background: #FECDD3; color: #9F1239; }
.nav-link.c-teal.router-link-active     { background: #99F6E4; color: #134E4A; }

.nav-signout:hover { background: #FEE2E2 !important; color: #B91C1C !important; }
</style>
