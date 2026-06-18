<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { createFamily } from "@/services/onboarding";

const auth = useAuthStore();
const router = useRouter();

const familyName = ref("");
const guidingLight = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  if (!familyName.value.trim()) {
    error.value = "Please give your family a name.";
    return;
  }
  busy.value = true;
  try {
    await createFamily({
      familyName: familyName.value.trim(),
      guidingLight: guidingLight.value.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      displayName: auth.user?.displayName || "",
    });
    // Pull the new familyId claim, then wait for the users/{uid} pointer
    // snapshot to flip hasFamily before navigating.
    await auth.refreshClaims();
    await waitForFamily();
    router.replace({ name: "dashboard" });
  } catch (e) {
    error.value = e?.message || "Could not create your family. Please try again.";
  } finally {
    busy.value = false;
  }
}

function waitForFamily(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (auth.hasFamily) return resolve();
    const start = Date.now();
    const id = setInterval(() => {
      if (auth.hasFamily || Date.now() - start > timeoutMs) {
        clearInterval(id);
        resolve();
      }
    }, 120);
  });
}
</script>

<template>
  <section class="onboarding">
    <h1>Set up your family</h1>
    <p class="lede">
      Two things to start. You can refine everything later — the
      <strong>guiding light</strong> is the single most important input: it
      anchors how the AI builds your curriculum and activities.
    </p>

    <form class="card" @submit.prevent="submit">
      <label>
        Family name
        <input v-model="familyName" type="text" required placeholder="e.g. Dar-al-Hikmah" />
      </label>
      <label>
        Main guiding light
        <textarea
          v-model="guidingLight"
          rows="5"
          placeholder="What anchors every decision and vision for your family? e.g. the Quran, Islam, a teaching tradition, an education philosophy…"
        ></textarea>
        <small>Whatever you write here strongly steers the curriculum's direction.</small>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? "Creating…" : "Create family" }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.onboarding { max-width: 560px; margin: 0 auto; }
.lede { color: #475569; line-height: 1.6; }
.card { display: flex; flex-direction: column; gap: 1rem; background: #fff; padding: 1.25rem; border-radius: 12px; border: 1px solid #e2e8f0; }
label { display: flex; flex-direction: column; font-size: 0.9rem; color: #334155; gap: 0.35rem; }
input, textarea { padding: 0.55rem 0.65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; font-family: inherit; }
small { color: #94a3b8; }
.btn { padding: 0.6rem 1rem; border-radius: 8px; border: none; font-size: 1rem; cursor: pointer; }
.btn.primary { background: #0b1f3a; color: #fff; }
.btn:disabled { opacity: 0.6; cursor: progress; }
.error { color: #b91c1c; font-size: 0.85rem; margin: 0; }
</style>
