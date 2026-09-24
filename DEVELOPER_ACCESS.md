# Developer Access

How developers get full access to this application (every page, no manual auth
ritual) — locally and in production — and why the two channels are different.

---

## Local development — full access, zero setup

Local development runs the **Firebase emulator suite** (auth, Firestore,
Functions — see `firebase.json`). While the app talks to emulators, it is
automatically unlocked for developers:

### The channel

1. Start the stack:
   ```bash
   firebase emulators:start --only auth,firestore,functions   # repo root
   npm run dev                                                # web/ — serves http://localhost:5173
   ```
   The web client auto-connects to the emulators in dev mode
   (`web/src/lib/firebase.js` → `isEmulator`).

2. Open **http://localhost:5173/login**. Because emulators are detected, a
   dashed **“Developer sign-in (local emulator)”** button appears under the
   Google button. Click it once — you land on the dashboard with a ready
   family.

3. Or skip the click entirely: **http://localhost:5173/login?dev=1**

### What the dev sign-in does

- Signs in as the fixed developer account **`dev@local.test` / `dev123456`**
  (creating it on first use — the auth emulator accepts account creation
  freely).
- If the account has no family yet, it calls the normal `createFamily` Cloud
  Function to create **“Dev Family”** — so every family-scoped page (Dashboard,
  Curriculum, Planner, Syllabus, Phonics, …) works exactly as in production.
- The session persists across reloads (emulator auth state in the browser).
- Everything runs against **local emulator data only**. Wiping data is safe:
  ```bash
  firebase emulators:start --only auth,firestore,functions --export-on-exit=./emulator-data --import=./emulator-data
  ```
  or just kill the emulators — nothing real is touched.

### Why this is safe

The channel is gated in code on `isEmulator` (`web/src/lib/firebase.js`),
which is true only when the client is connected to `localhost` emulators:

- In a **production build** the button does not render and the flow cannot run
  (`import.meta.env.DEV` is false unless someone explicitly sets
  `VITE_USE_EMULATORS=true` — which, again, points the client at emulators,
  not at the live project).
- The developer account exists **only in the local auth emulator**. The live
  project has no such account, so even a forced attempt fails with
  invalid-credentials.

Implemented in `web/src/views/LoginView.vue` (`devSignIn`) and covered by
`tests/e2e/dev-access.spec.js` (button flow, session persistence, `?dev=1`).

---

## Production (https://homeschooling-b3e57.web.app) — no backdoor, by design

There is **deliberately no auth bypass in production**. Production data is real
family data; an unauthenticated backdoor would be a security hole, not a dev
feature. Legitimate ways to work against production:

| Need | How |
|---|---|
| Inspect data / users / functions | Firebase Console: https://console.firebase.google.com/project/homeschooling-b3e57 (owner access via the project's Google account) |
| Use the app as a real user | Register through the normal sign-up — it's our own project; creating your own account is free and expected |
| Test production builds locally with prod-like data | Build with `VITE_USE_EMULATORS=false` + real `.env.production` values, but point at **emulators** (`firebase emulators:start`) to avoid touching live data |
| Ship code | `firebase deploy --only hosting` (functions/rules require deliberate review — they affect real users) |

If a superadmin-style backdoor is ever genuinely needed for production
support, it must go through Firebase Auth properly (e.g. a superadmin claim —
see `meta.role: "superadmin"` support in the router and the `platformRole`
custom claim), never through a disabled guard.

---

## Quick reference

| Thing | Value |
|---|---|
| Dev account (emulator only) | `dev@local.test` / `dev123456` |
| Dev family | “Dev Family” (auto-created on first dev sign-in) |
| Auto sign-in URL | `http://localhost:5173/login?dev=1` |
| Emulator UI | http://127.0.0.1:4000 (when emulators run) |
| Emulator ports | auth 9099 · firestore 8080 · functions 5001 · hosting 5000 · vite 5173 |
| Full e2e suite (starts emulators itself) | `npm run test:e2e` (repo root) |

> Known Windows quirk: `firebase emulators:exec`/`emulators:start` sometimes
> leaves an orphaned Java (Firestore) process after a failed run, and the
> Functions emulator can hit a cold-load timeout on the first start. If ports
> 8080/9099/5001 are taken or functions calls fail: kill the listeners
> (`netstat -ano | findstr :8080` → `taskkill /F /PID <pid>`) and start again.
