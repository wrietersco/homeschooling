<script setup>
import GuideChat from "@/components/GuideChat.vue";
</script>

<template>
  <section class="guide">
    <h1>Ask the guide</h1>
    <p class="lede">
      A read-only assistant that knows your family's children, skills, curriculum,
      activities, scores, and observations — and remembers your past questions.
    </p>
    <GuideChat />
  </section>
</template>

<style scoped>
.guide { max-width: 720px; }
.lede { color: #475569; }
</style>
