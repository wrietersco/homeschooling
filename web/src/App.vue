<script setup>
import { RouterView } from "vue-router";
import AppNav from "@/components/AppNav.vue";
import ContentBackfill from "@/components/ContentBackfill.vue";
</script>

<template>
  <div class="app-shell">
    <AppNav />
    <main class="app-main">
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
