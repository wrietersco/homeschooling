<script setup>
import { ref, nextTick } from "vue";
import { askGuide } from "@/services/guide";

const messages = ref([]); // { role: 'user'|'assistant', text }
const input = ref("");
const busy = ref(false);
const error = ref("");
const listEl = ref(null);

async function scrollDown() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

async function send() {
  const text = input.value.trim();
  if (!text || busy.value) return;
  error.value = "";
  messages.value.push({ role: "user", text });
  input.value = "";
  busy.value = true;
  await scrollDown();
  try {
    const res = await askGuide(text);
    messages.value.push({ role: "assistant", text: res.text, configured: res.configured });
  } catch (e) {
    error.value = e?.message || "The guide could not respond.";
  } finally {
    busy.value = false;
    await scrollDown();
  }
}
</script>

<template>
  <section class="guide">
    <h1>Ask the guide</h1>
    <p class="lede">
      A read-only assistant that answers questions about your family's children,
      skills, curriculum, activities, scores, and observations.
    </p>

    <div ref="listEl" class="thread" aria-live="polite">
      <p v-if="!messages.length" class="empty">
        Try: “Who are my children?” or “Which skills is each child working on?”
      </p>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <span class="who">{{ m.role === "user" ? "You" : "Guide" }}</span>
        <p>{{ m.text }}</p>
      </div>
      <div v-if="busy" class="msg assistant"><span class="who">Guide</span><p class="dots">…</p></div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="composer" @submit.prevent="send">
      <input v-model="input" type="text" placeholder="Ask about your family…" aria-label="Your question" :disabled="busy" />
      <button class="btn primary" type="submit" :disabled="busy || !input.trim()">Send</button>
    </form>
  </section>
</template>

<style scoped>
.guide { max-width: 720px; }
.lede { color: #475569; }
.thread { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; min-height: 220px; max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; }
.empty { color: #94a3b8; }
.msg { display: flex; flex-direction: column; gap: 0.15rem; }
.msg .who { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; }
.msg p { margin: 0; padding: 0.5rem 0.75rem; border-radius: 10px; white-space: pre-wrap; }
.msg.user { align-items: flex-end; }
.msg.user p { background: #eef2ff; }
.msg.assistant p { background: #f1f5f9; }
.composer { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.composer input { flex: 1; padding: 0.6rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.btn { padding: 0.6rem 1.1rem; border-radius: 8px; border: none; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn:disabled { opacity: 0.6; }
.error { color: #b91c1c; }
.dots { color: #94a3b8; }
</style>
