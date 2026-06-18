# Dar-al-Hikmah OS

A serverless, local-first homeschool operations hub for the Dar-al-Hikmah household,
deployed on Firebase (Hosting + Firestore + Cloud Functions).

## Crew
- **Muhandis Hadi (7)** — Lead Flight Engineer. Blue rocket station, earns **Rocket Points**. Competition is channeled into *personal-best scores only* — never a curve, never compared to his brother.
- **Khatib Ibrahim (6)** — Lead Systems Mechanic. Orange mechanical-tool station. Engaged through voice, narration, and hands-on building.

## Pages
| File | Role |
|------|------|
| `public/index.html` | Kid Mission Terminal — live token balances, block countdown, side-by-side missions |
| `public/admin.html` | Parents' Ops Hub — binary payout validators, sprint control, Inject Subroutine, Crisis Intercom |
| `public/bootstrap.js` | Zero-config Firestore seeder (crew, system, full 5-day × 8-block schedule) |
| `functions/index.js` | Gemini intercom + injector, day analyze/retune/draft, weekly ledger, nightly archive |

## Architecture
- **Frontend:** zero-framework HTML5 + variable-driven CSS3 + ES6 modules, Firebase v10 modular CDN.
- **Database:** Cloud Firestore, real-time via `onSnapshot`. Balances mutate only through atomic `increment()`.
- **AI:** Gemini key stays server-side in Cloud Functions; the browser calls `/api/crisis`, `/api/inject`, `/api/analyze-day`, `/api/retune-day`, and `/api/draft-day`. Retune/draft always preview before the parent applies changes in the planner. If functions are offline, the admin console falls back to a built-in deterministic protocol engine for crisis/inject, and analyze-day still returns deterministic stats without Gemini.

## Run locally
```bash
cd functions && npm install && cd ..
firebase emulators:start          # hosting :5000, firestore :8080, functions :5001, UI :4000
```
Open http://localhost:5000 (terminal) and http://localhost:5000/admin.html (ops hub).

## Deploy
```bash
firebase functions:secrets:set GEMINI_API_KEY   # one-time, paste the key
firebase deploy --only hosting,firestore:rules,firestore:indexes
firebase deploy --only functions                # requires Blaze plan
```

## Schedule design
8 sequential one-hour blocks, 08:30–16:30, Mon–Fri. Block 4 (11:30) is always the
**Muwajahah** interdependent co-op engine with a **Shared Success lock**: neither boy
is paid if a breakdown, blame-shift, or unchecked meltdown occurs. The week's blocks
collectively cover all nine Master Wishlist vectors.
