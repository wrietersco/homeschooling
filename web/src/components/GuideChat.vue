<script setup>
// Reusable guide chat panel. Read-only, omniscient over the family's data, knows
// which guardian is signed in, and replays this guardian's own prior thread so
// the conversation continues where they left off. Used both on the dedicated
// Guide page and embedded on the Activity Player page.
import { ref, nextTick, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { askGuide, loadGuideHistory, clearGuideHistory } from "@/services/guide";

const props = defineProps({
  // Optional hint about what the guardian is currently looking at, forwarded to
  // the agent so answers are in-the-moment (e.g. the open activity).
  context: { type: String, default: "" },
  placeholder: { type: String, default: "Ask about your family…" },
});

const auth = useAuthStore();

const messages = ref([]); // { role: 'user'|'assistant', text }
const input = ref("");
const busy = ref(false);
const clearing = ref(false);
const error = ref("");
const loadingHistory = ref(true);
const listEl = ref(null);

async function scrollDown() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

onMounted(async () => {
  try {
    if (auth.familyId && auth.user?.uid) {
      messages.value = await loadGuideHistory(auth.familyId, auth.user.uid);
    }
  } catch {
    // a missing thread is fine — start fresh
  } finally {
    loadingHistory.value = false;
    await scrollDown();
  }
});

async function clearChat() {
  if (clearing.value || busy.value) return;
  if (!window.confirm("Clear this conversation? The guide will forget what you've discussed so far.")) return;
  clearing.value = true;
  error.value = "";
  try {
    await clearGuideHistory();
    messages.value = [];
  } catch (e) {
    error.value = e?.message || "Could not clear the chat.";
  } finally {
    clearing.value = false;
  }
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
    const res = await askGuide(text, props.context);
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
  <div class="guide-chat">
    <div v-if="messages.length && !loadingHistory" class="chat-tools">
      <button class="clear-btn" :disabled="clearing || busy" @click="clearChat">
        {{ clearing ? "Clearing…" : "Clear chat" }}
      </button>
    </div>
    <div ref="listEl" class="thread" aria-live="polite">
      <p v-if="loadingHistory" class="empty">Loading your conversation…</p>
      <p v-else-if="!messages.length" class="empty">
        Try: “How is each child doing?” or “How should I teach this activity?”
      </p>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <span class="who">{{ m.role === "user" ? "You" : "Guide" }}</span>
        <p>{{ m.text }}</p>
      </div>
      <div v-if="busy" class="msg assistant"><span class="who">Guide</span><p class="dots">…</p></div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form class="composer" @submit.prevent="send">
      <input v-model="input" type="text" :placeholder="placeholder" aria-label="Your question" :disabled="busy" />
      <button class="btn primary" type="submit" :disabled="busy || !input.trim()">Send</button>
    </form>
  </div>
</template>

<style scoped>
.guide-chat { display: flex; flex-direction: column; }
.chat-tools { display: flex; justify-content: flex-end; margin-bottom: 0.4rem; }
.clear-btn { background: none; border: none; cursor: pointer; font: inherit; font-size: 0.78rem; color: #94a3b8; padding: 0.1rem 0.25rem; text-decoration: underline; }
.clear-btn:hover:not(:disabled) { color: #b91c1c; }
.clear-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.thread { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; min-height: 200px; max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; }
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
