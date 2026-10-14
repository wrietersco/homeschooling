<script setup>
// WikidoGate — the quick door into Wikido for visitors arriving from a shared
// link. Wikido is playable by ANY signed-in account (no family, onboarding, or
// subscription needed), so this gate only proves identity: sign in or create
// an account right here on the Wikido backdrop. The moment auth resolves,
// WikidoView flips to the shelf — no redirects, no lost context.
import { ref } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

const mode = ref("signin");
const displayName = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

function friendly(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Incorrect email or password.";
  if (code.includes("email-already-in-use")) return "That email is already registered — try signing in.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email.";
  if (code.includes("popup-closed") || code.includes("cancelled-popup-request")) return "Google sign-in was cancelled.";
  return e?.message || "Something went wrong. Please try again.";
}

async function submit() {
  error.value = ""; busy.value = true;
  try {
    if (mode.value === "register") await auth.register(email.value.trim(), password.value, displayName.value.trim());
    else await auth.login(email.value.trim(), password.value);
    // nothing else to do — the view reacts to auth.user and reveals the shelf
  } catch (e) { error.value = friendly(e); }
  finally { busy.value = false; }
}

async function google() {
  error.value = ""; busy.value = true;
  try { await auth.loginWithGoogle(); }
  catch (e) { error.value = friendly(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="wd-gate">
    <div class="wd-gate-card" role="dialog" aria-label="Sign in to explore Wikido">
      <div class="wd-gate-brand">
        <span class="material-symbols-rounded wd-gate-logo" aria-hidden="true">travel_explore</span>
        <h1 class="wd-gate-title">Wikido</h1>
      </div>
      <p class="wd-gate-sub">Wander through pictures. Tap what looks interesting. Listen and discover.</p>

      <form class="wd-gate-form" @submit.prevent="submit">
        <label v-if="mode === 'register'">
          <span class="wd-gate-label"><span class="material-symbols-rounded" aria-hidden="true">badge</span> Your name</span>
          <input v-model="displayName" type="text" autocomplete="name" placeholder="e.g. Abu Hadi" />
        </label>
        <label>
          <span class="wd-gate-label"><span class="material-symbols-rounded" aria-hidden="true">mail</span> Email</span>
          <input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" />
        </label>
        <label>
          <span class="wd-gate-label"><span class="material-symbols-rounded" aria-hidden="true">lock</span> Password</span>
          <input v-model="password" type="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            required minlength="6" placeholder="••••••••" />
        </label>

        <p v-if="error" class="wd-gate-error" role="alert">
          <span class="material-symbols-rounded" aria-hidden="true">error</span> {{ error }}
        </p>

        <button class="wd-gate-primary" type="submit" :disabled="busy">
          <span class="material-symbols-rounded" aria-hidden="true">{{ mode === 'register' ? 'person_add' : 'login' }}</span>
          {{ busy ? "Please wait…" : mode === "register" ? "Create account & explore" : "Sign in & explore" }}
        </button>
      </form>

      <button class="wd-gate-google" type="button" :disabled="busy" @click="google">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      <p class="wd-gate-switch">
        <template v-if="mode === 'signin'">
          New here?
          <button class="wd-gate-link" type="button" @click="mode = 'register'; error = ''">Create an account</button>
        </template>
        <template v-else>
          Already have an account?
          <button class="wd-gate-link" type="button" @click="mode = 'signin'; error = ''">Sign in</button>
        </template>
      </p>
      <p class="wd-gate-hint">Wikido is free to wander — you can set up your family later.</p>
    </div>
  </div>
</template>

<style scoped>
.wd-gate {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  overflow-y: auto;
}
.wd-gate-card {
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  background: rgba(255, 253, 247, 0.07);
  border: 1.5px solid rgba(253, 230, 138, 0.35);
  border-radius: 22px;
  padding: 1.75rem 1.5rem;
  backdrop-filter: blur(10px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
}
.wd-gate-brand { display: flex; align-items: center; gap: 0.75rem; }
.wd-gate-logo {
  font-size: 34px;
  color: #FDE68A;
  background: rgba(253, 230, 138, 0.14);
  border: 1.5px solid rgba(253, 230, 138, 0.4);
  border-radius: 14px;
  padding: 0.45rem;
}
.wd-gate-title { margin: 0; font-size: 1.7rem; color: #FFF7EA; letter-spacing: 0.01em; }
.wd-gate-sub { margin: 0; color: rgba(255, 247, 234, 0.8); font-size: 0.92rem; line-height: 1.45; }

.wd-gate-form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.25rem; }
.wd-gate-form label { display: flex; flex-direction: column; gap: 0.3rem; }
.wd-gate-label {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.85rem; font-weight: 600; color: #FDE68A;
}
.wd-gate-label .material-symbols-rounded { font-size: 15px; }
.wd-gate-form input {
  padding: 0.6rem 0.75rem;
  border: 1.5px solid rgba(253, 230, 138, 0.35);
  border-radius: 11px;
  background: rgba(20, 11, 32, 0.55);
  color: #FFF7EA;
  font: inherit;
  font-size: 0.95rem;
}
.wd-gate-form input::placeholder { color: rgba(255, 247, 234, 0.4); }
.wd-gate-form input:focus { outline: 2px solid #FDE68A; outline-offset: 1px; }

.wd-gate-error {
  display: flex; align-items: center; gap: 0.3rem;
  margin: 0;
  color: #FECACA; font-size: 0.82rem;
  background: rgba(185, 28, 28, 0.35);
  padding: 0.5rem 0.7rem; border-radius: 9px;
}
.wd-gate-error .material-symbols-rounded { font-size: 16px; }

.wd-gate-primary, .wd-gate-google {
  display: flex; align-items: center; justify-content: center; gap: 0.45rem;
  padding: 0.65rem 1rem;
  border-radius: 11px;
  border: 1px solid transparent;
  font: inherit; font-size: 0.95rem; font-weight: 600;
  cursor: pointer;
}
.wd-gate-primary {
  background: linear-gradient(135deg, #FDE68A, #F59E0B);
  color: #3B1D5E;
  box-shadow: 0 3px 14px rgba(253, 230, 138, 0.3);
}
.wd-gate-primary .material-symbols-rounded { font-size: 18px; }
.wd-gate-google {
  background: rgba(255, 253, 247, 0.92);
  color: #374151;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.25);
}
.wd-gate-primary:disabled, .wd-gate-google:disabled { opacity: 0.6; cursor: progress; }

.wd-gate-switch { margin: 0; text-align: center; font-size: 0.85rem; color: rgba(255, 247, 234, 0.75); }
.wd-gate-link {
  background: none; border: none; padding: 0;
  color: #FDE68A; font: inherit; font-weight: 700;
  cursor: pointer; text-decoration: underline;
}
.wd-gate-hint { margin: 0; text-align: center; font-size: 0.75rem; color: rgba(255, 247, 234, 0.5); }
</style>
