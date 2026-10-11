<script setup>
import { RouterView, useRoute } from "vue-router";
import AppNav from "@/components/AppNav.vue";
import ContentBackfill from "@/components/ContentBackfill.vue";
const route = useRoute();
</script>

<template>
  <div class="app-shell">
    <!-- Immersive routes (Wikido) own the whole screen — no nav chrome. -->
    <AppNav v-if="!route.meta.immersive" />
    <main
      class="app-main"
      :class="{ 'app-main-wide': route.path === '/platform', 'app-main-immersive': route.meta.immersive }"
    >
      <RouterView />
    </main>
    <ContentBackfill />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-main {
  flex: 1;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
</style>
<style scoped>
.app-main-wide { max-width: none; padding: 0; background: #f5f6fa; }
.app-main-immersive { max-width: none; padding: 0; overflow: hidden; }
</style>
