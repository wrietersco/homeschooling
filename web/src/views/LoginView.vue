<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const mode = ref("signin");
const email = ref("");
const password = ref("");
const displayName = ref("");
const error = ref("");
const busy = ref(false);

function friendly(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Incorrect email or password.";
  if (code.includes("email-already-in-use")) return "That email is already registered — try signing in.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email.";
  if (code.includes("popup-closed")) return "Google sign-in was cancelled.";
  return e?.message || "Something went wrong. Please try again.";
}

function waitUntil(predicate, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (predicate()) return resolve();
    const start = Date.now();
    const id = setInterval(() => {
      if (predicate() || Date.now() - start > timeoutMs) { clearInterval(id); resolve(); }
    }, 80);
  });
}

async function afterAuth() {
  await auth.ready();
  await waitUntil(() => auth.user && auth.profileLoaded);
  const redirect = route.query.redirect;
  if (auth.hasFamily) router.replace(redirect || { name: "dashboard" });
  else router.replace({ name: "onboarding" });
}

async function submit() {
  error.value = ""; busy.value = true;
  try {
    if (mode.value === "register") await auth.register(email.value.trim(), password.value, displayName.value.trim());
    else await auth.login(email.value.trim(), password.value);
    await afterAuth();
  } catch (e) { error.value = friendly(e); }
  finally { busy.value = false; }
}

async function google() {
  error.value = ""; busy.value = true;
  try { await auth.loginWithGoogle(); await afterAuth(); }
  catch (e) { error.value = friendly(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="login">
    <!-- Logo -->
    <div class="logo-wrap">
      <div class="logo-icon">
        <span class="material-symbols-rounded">auto_stories</span>
      </div>
      <h1>{{ mode === "register" ? "Create account" : "Welcome back" }}</h1>
      <p class="tagline">Dar-al-Hikmah OS</p>
    </div>

    <form class="card" @submit.prevent="submit">
      <label v-if="mode === 'register'">
        <span class="label-row"><span class="material-symbols-rounded licon">badge</span> Your name</span>
        <input v-model="displayName" type="text" autocomplete="name" placeholder="e.g. Abu Hadi" />
      </label>
      <label>
        <span class="label-row"><span class="material-symbols-rounded licon">mail</span> Email</span>
        <input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" />
      </label>
      <label>
        <span class="label-row"><span class="material-symbols-rounded licon">lock</span> Password</span>
        <input v-model="password" type="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          required minlength="6" placeholder="••••••••" />
      </label>

      <p v-if="error" class="error" role="alert">
        <span class="material-symbols-rounded">error</span> {{ error }}
      </p>

      <button class="btn primary" type="submit" :disabled="busy">
        <span class="material-symbols-rounded">{{ mode === 'register' ? 'person_add' : 'login' }}</span>
        {{ busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in" }}
      </button>
    </form>

    <button class="btn google" type="button" :disabled="busy" @click="google">
      <svg class="g-logo" viewBox="0 0 24 24" width="18" height="18">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Continue with Google
    </button>

    <p class="switch">
      <template v-if="mode === 'signin'">
        New here?
        <button class="linkish" type="button" @click="mode = 'register'">Create an account</button>
      </template>
      <template v-else>
        Already have an account?
        <button class="linkish" type="button" @click="mode = 'signin'">Sign in</button>
      </template>
    </p>
  </section>
</template>

<style scoped>
.login { max-width: 380px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.85rem; }

.logo-wrap { text-align: center; padding: 1rem 0 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
.logo-icon {
  width: 60px; height: 60px; border-radius: 16px;
  background: linear-gradient(135deg, #9333EA, #C026D3);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(147,51,234,.3);
}
.logo-icon .material-symbols-rounded { font-size: 32px; color: #fff; }
h1 { margin: 0; font-size: 1.4rem; color: #3B0764; }
.tagline { margin: 0; font-size: 0.8rem; color: #9CA3AF; }

.card {
  display: flex; flex-direction: column; gap: 0.85rem;
  background: #fff; padding: 1.5rem 1.25rem;
  border-radius: 16px; border: 1px solid #EDE9FE;
  box-shadow: 0 2px 16px rgba(147,51,234,.08);
}
label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; color: #4B5563; }
.label-row { display: flex; align-items: center; gap: 0.3rem; color: #6B21A8; font-weight: 500; }
.licon { font-size: 15px; }
input {
  padding: 0.55rem 0.7rem;
  border: 1px solid #D8B4FE;
  border-radius: 10px;
  font-size: 0.95rem;
  font: inherit;
}

.btn {
  display: flex; align-items: center; justify-content: center; gap: 0.4rem;
  padding: 0.6rem 1rem; border-radius: 10px;
  border: 1px solid transparent; font-size: 0.95rem; cursor: pointer; font: inherit;
}
.btn.primary {
  background: linear-gradient(135deg, #9333EA, #C026D3);
  color: #fff;
  box-shadow: 0 2px 8px rgba(147,51,234,.25);
}
.btn.primary .material-symbols-rounded { font-size: 18px; }
.btn.google {
  background: #fff; border-color: #E5E7EB;
  color: #374151; gap: 0.5rem;
  box-shadow: 0 1px 4px rgba(0,0,0,.08);
}
.g-logo { flex-shrink: 0; }
.btn:disabled { opacity: 0.6; cursor: progress; }

.error {
  display: flex; align-items: center; gap: 0.3rem;
  color: #B91C1C; font-size: 0.82rem;
  background: #FEE2E2; padding: 0.5rem 0.7rem; border-radius: 8px; margin: 0;
}
.error .material-symbols-rounded { font-size: 16px; }

.switch { text-align: center; font-size: 0.82rem; color: #6B7280; margin: 0; }
.linkish { background: none; border: none; color: #9333EA; cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
</style>
