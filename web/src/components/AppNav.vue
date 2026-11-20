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
const gamesActive = computed(() =>
  route.path.startsWith("/explore") || route.path.startsWith("/phonics") || route.path.startsWith("/wikido") || route.path.startsWith("/games")
);

// MOBILE sheet — below the tablet breakpoint the link strip can't fit (14
// signed-in links need ~1200px of horizontal swipe), so .links turns into a
// slide-down sheet driven by the hamburger. CSS swaps the layout; this ref
// only toggles it.
const menuOpen = ref(false);
const navEl = ref(null);

function toggleGames() {
  gamesOpen.value = !gamesOpen.value;
}

function closeGames() {
  gamesOpen.value = false;
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onDocClick(e) {
  if (navEl.value && !navEl.value.contains(e.target)) {
    closeGames();
    closeMenu();
    return;
  }
  if (gamesMenu.value && !gamesMenu.value.contains(e.target)) closeGames();
}

function onKeydown(e) {
  if (e.key === "Escape") {
    closeGames();
    closeMenu();
  }
}

watch(() => route.fullPath, () => {
  closeGames();
  closeMenu();
});

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
  <header ref="navEl" class="nav">
    <RouterLink to="/" class="brand">
      <span class="material-symbols-rounded brand-icon">auto_stories</span>
      <span class="brand-text">Dar-al-Hikmah OS</span>
    </RouterLink>

    <!-- Hamburger — only rendered/visible below the tablet breakpoint, where
         the horizontal strip can no longer hold every link. -->
    <button
      class="menu-toggle"
      type="button"
      :aria-expanded="menuOpen"
      aria-controls="main-nav-links"
      :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
      @click="toggleMenu"
    >
      <span class="material-symbols-rounded">{{ menuOpen ? "close" : "menu" }}</span>
    </button>

    <nav id="main-nav-links" class="links" :class="{ 'links-open': gamesOpen, 'menu-open': menuOpen }">
      <RouterLink to="/" class="nav-link c-pink" exact title="Home">
        <span class="material-symbols-rounded">home</span>
        <span class="lbl">Home</span>
      </RouterLink>

      <template v-if="auth.user && auth.hasFamily">
        <RouterLink to="/dashboard" class="nav-link c-blue" title="Dashboard">
          <span class="material-symbols-rounded">grid_view</span>
          <span class="lbl">Dashboard</span>
        </RouterLink>
        <RouterLink to="/profile" class="nav-link c-lavender" title="Profile">
          <span class="material-symbols-rounded">family_restroom</span>
          <span class="lbl">Profile</span>
        </RouterLink>
        <RouterLink to="/subscription" class="nav-link c-lavender" title="Learning package"><span class="material-symbols-rounded">card_membership</span><span class="lbl">Learning package</span></RouterLink>
        <RouterLink to="/guardians" class="nav-link c-peach" title="Guardians">
          <span class="material-symbols-rounded">supervisor_account</span>
          <span class="lbl">Guardians</span>
        </RouterLink>
        <RouterLink to="/children" class="nav-link c-mint" title="Children">
          <span class="material-symbols-rounded">child_care</span>
          <span class="lbl">Children</span>
        </RouterLink>
        <RouterLink to="/skills" class="nav-link c-yellow" title="Skills">
          <span class="material-symbols-rounded">school</span>
          <span class="lbl">Skills</span>
        </RouterLink>
        <RouterLink to="/guide" class="nav-link c-sky" title="Guide">
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
            <!-- The listing page itself: every game, one playful grid. -->
            <RouterLink to="/games" class="nav-link c-pink" @click="closeGames">
              <span class="material-symbols-rounded">sports_esports</span>
              <span class="lbl">All Games</span>
            </RouterLink>
            <RouterLink to="/explore" class="nav-link c-peach" @click="closeGames">
              <span class="material-symbols-rounded">rocket_launch</span>
              <span class="lbl">Explore</span>
            </RouterLink>
            <RouterLink to="/wikido" class="nav-link c-yellow" @click="closeGames">
              <span class="material-symbols-rounded">travel_explore</span>
              <span class="lbl">Wikido</span>
            </RouterLink>
            <RouterLink to="/phonics" class="nav-link c-mint" @click="closeGames">
              <span class="material-symbols-rounded">abc</span>
              <span class="lbl">Phonics</span>
            </RouterLink>
            <!-- Math Games lives as static pages under /games/math/ (same pattern as the
                 wikido world assets), so an ordinary anchor — not a RouterLink —
                 and a full page load is exactly what we want. ?from brings the
                 kid back here via the math page's return pill. Division Playland
                 sits indented beneath it to mirror the page hierarchy. -->
            <a href="/games/math/index.html?from=/games" class="nav-link c-sky" @click="closeGames">
              <span class="material-symbols-rounded">calculate</span>
              <span class="lbl">Math Games</span>
            </a>
            <a href="/games/math/division.html" class="nav-link c-sky child-link" @click="closeGames">
              <span class="material-symbols-rounded">content_cut</span>
              <span class="lbl">Division Playland</span>
            </a>
          </div>
        </div>
        <RouterLink to="/curriculum" class="nav-link c-rose" title="Curriculum">
          <span class="material-symbols-rounded">menu_book</span>
          <span class="lbl">Curriculum</span>
        </RouterLink>
        <RouterLink to="/syllabus" class="nav-link c-teal" title="Syllabus">
          <span class="material-symbols-rounded">format_list_bulleted</span>
          <span class="lbl">Syllabus</span>
        </RouterLink>
        <RouterLink to="/planner" class="nav-link c-peach" title="Planner">
          <span class="material-symbols-rounded">calendar_month</span>
          <span class="lbl">Planner</span>
        </RouterLink>
        <RouterLink to="/session" class="nav-link c-mint" title="Play">
          <span class="material-symbols-rounded">play_circle</span>
          <span class="lbl">Play</span>
        </RouterLink>
      </template>

      <RouterLink v-if="auth.isSuperAdmin" to="/platform" class="nav-link c-rose" title="Platform">
        <span class="material-symbols-rounded">admin_panel_settings</span>
        <span class="lbl">Platform</span>
      </RouterLink>

      <RouterLink v-if="!auth.user" to="/login" class="nav-link c-lavender" title="Sign in">
        <span class="material-symbols-rounded">login</span>
        <span class="lbl">Sign in</span>
      </RouterLink>
      <button v-else class="nav-link nav-signout" type="button" title="Sign out" @click="auth.logout()">
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

/* Hamburger — hidden on the desktop strip, shown below the tablet
   breakpoint where the strip can no longer hold every link. */
.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--primary-soft);
  color: #7C3AED;
  cursor: pointer;
}
.menu-toggle:active { transform: scale(0.94); }
.menu-toggle .material-symbols-rounded { font-size: 26px; }

.links {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #DDD6FE transparent;
}
.links::-webkit-scrollbar { height: 4px; }
.links::-webkit-scrollbar-thumb { background: #DDD6FE; border-radius: 4px; }
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
/* A game nested under its collection — indented + slightly smaller, mirroring
   the Games page → Math Games → Division Playland hierarchy. */
.games-dropdown .child-link { margin-left: 1.3rem; font-size: 0.72rem; padding-top: 0.3rem; padding-bottom: 0.3rem; }

/* ── Tablet & below (1024px): hamburger + slide-down sheet ─────────────────
   The horizontal strip physically cannot fit the signed-in nav (14 links ≈
   1200px), so on phones/tablets the same .links markup becomes a full-width
   sheet with big, thumb-friendly rows. Pure CSS — one DOM tree, two skins. */
@media (max-width: 1023.98px) {
  .nav { padding: 0.5rem 0.9rem; }
  .menu-toggle { display: inline-flex; }

  .links {
    display: none;
    overflow: visible;
  }
  .links.menu-open {
    display: flex;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 110;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
    padding: 0.8rem 0.9rem 1rem;
    background: #fff;
    border-bottom: 1px solid #F3E8FF;
    box-shadow: 0 22px 34px rgba(147, 51, 234, 0.18);
    max-height: calc(100vh - 64px);
    max-height: calc(100dvh - 64px);
    overflow-y: auto;
    animation: sheet-in 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  @keyframes sheet-in {
    from { transform: translateY(-10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Big rows: 44px+ touch targets, readable labels, colour-coded icons. */
  .links.menu-open .nav-link {
    padding: 0.7rem 0.85rem;
    font-size: 0.98rem;
    font-weight: 600;
    border-radius: 14px;
  }
  .links.menu-open .nav-link .material-symbols-rounded { font-size: 23px; }
  .links.menu-open .nav-link:hover { background: #F5F3FF; }

  /* The Games submenu becomes an inline accordion — no absolute panel, so
     nothing can clip or escape the sheet. */
  .games-menu { position: static; flex-direction: column; align-items: stretch; }
  .games-dropdown {
    position: static;
    min-width: 0;
    border: none;
    box-shadow: none;
    padding: 0.15rem 0 0 0.7rem;
  }
  .games-dropdown .nav-link { padding: 0.6rem 0.8rem; font-size: 0.92rem; }
  .games-dropdown .child-link { margin-left: 1.1rem; }
}

/* ── Narrow desktop (1024–1279px): the strip fits only without labels, so
   collapse them to visually-hidden text (screen readers keep the names,
   mouse users get the title tooltip from each link). ────────────────────── */
@media (min-width: 1024px) and (max-width: 1279.98px) {
  .links .lbl {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .nav-link { padding: 0.42rem 0.5rem; }
  .nav-link .material-symbols-rounded { font-size: 20px; }
  /* Soft right-edge fade hints that the strip scrolls when it overflows. */
  .links {
    mask-image: linear-gradient(to right, #000 88%, transparent 99%);
    -webkit-mask-image: linear-gradient(to right, #000 88%, transparent 99%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .links.menu-open { animation: none; }
}
</style>
