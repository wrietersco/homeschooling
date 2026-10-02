<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const route = useRoute();

// GAMES dropdown — Explore + Phonics live behind one top-level menu so the
// nav bar stays scannable. Click-to-open (touch friendly); closes on outside
// click, Escape, route change, or submenu navigation.
const gamesOpen = ref(false);
const gamesMenu = ref(null);
const gamesActive = computed(() => route.path.startsWith("/explore") || route.path.startsWith("/phonics"));

function toggleGames() {
  gamesOpen.value = !gamesOpen.value;
}

function closeGames() {
  gamesOpen.value = false;
}

function onDocClick(e) {
  if (gamesMenu.value && !gamesMenu.value.contains(e.target)) closeGames();
}

function onKeydown(e) {
  if (e.key === "Escape") closeGames();
}

watch(() => route.fullPath, closeGames);

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <header class="nav">
    <RouterLink to="/" class="brand">
      <span class="material-symbols-rounded brand-icon">auto_stories</span>
      <span class="brand-text">Dar-al-Hikmah OS</span>
    </RouterLink>

    <nav class="links" :class="{ 'links-open': gamesOpen }">
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
        <RouterLink to="/subscription" class="nav-link c-lavender"><span class="material-symbols-rounded">card_membership</span><span class="lbl">Subscription</span></RouterLink>
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
        <!-- A DISCLOSURE, not an ARIA menu: role="menu"/"menuitem" would promise a
             menu widget (arrow-key navigation, focus management, typeahead) that
             this doesn't implement, and it hides the fact that these are ordinary
             links — assistive tech announced "menu item" instead of "link", and
             nothing could find them by link role. Button + aria-expanded +
             aria-controls over plain links is the honest, working pattern. -->
        <div v-if="auth.user && auth.hasFamily" ref="gamesMenu" class="games-menu">
          <button
            class="nav-link c-lavender games-toggle"
            :class="{ 'router-link-active': gamesActive }"
            type="button"
            :aria-expanded="gamesOpen"
            aria-controls="games-submenu"
            @click="toggleGames"
          >
            <span class="material-symbols-rounded">sports_esports</span>
            <span class="lbl">Games</span>
            <span class="material-symbols-rounded games-caret" :class="{ open: gamesOpen }">expand_more</span>
          </button>
          <div v-if="gamesOpen" id="games-submenu" class="games-dropdown">
            <RouterLink to="/explore" class="nav-link c-peach" @click="closeGames">
              <span class="material-symbols-rounded">rocket_launch</span>
              <span class="lbl">Explore</span>
            </RouterLink>
            <RouterLink to="/phonics" class="nav-link c-mint" @click="closeGames">
              <span class="material-symbols-rounded">abc</span>
              <span class="lbl">Phonics</span>
            </RouterLink>
          </div>
        </div>
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
/* While the Games dropdown is open, let it escape the scroll container —
   overflow-x:auto would otherwise clip the absolutely-positioned panel. */
.links-open { overflow: visible; }

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

/* GAMES dropdown */
.games-menu { position: relative; display: flex; }
.games-toggle .games-caret {
  font-size: 15px;
  margin-left: -0.1rem;
  transition: transform .15s;
}
.games-toggle .games-caret.open { transform: rotate(180deg); }

.games-dropdown {
  position: absolute;
  top: calc(100% + 0.45rem);
  left: 0;
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 9.5rem;
  padding: 0.4rem;
  background: #fff;
  border: 1px solid #F3E8FF;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(147, 51, 234, .16);
}
.games-dropdown .nav-link { padding: 0.45rem 0.6rem; font-size: 0.8rem; border-radius: 10px; }
</style>
