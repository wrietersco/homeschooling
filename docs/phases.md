# Phased SaaS rollout

## Phase gates

Each phase: implement → `npm test` (unit + Playwright with emulator seed/cleanup) → deploy → **your approval** before the next phase.

## Phase checklist

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | Firebase Auth, family onboarding, `families/{familyId}/…` tenancy, membership rules, login/onboarding | Done |
| **2** | `scheduleTemplates/{weekday}` + `blocks/{slotId}`; summary-first UI; lazy activity detail on planner click | Done (this doc) |
| **3** | `calendarDays/{dateKey}` instances materialized from templates; player/admin use dated days | Done (this doc) |
| **4** | Member roles, invites, superadmin + `platform.html` | Done (this doc) |
| **5** | Provider signup, multi-family provider access | Done (this doc) |

Approve each phase in chat before treating the next as production-ready.

### Phase 2 — Schedule shape + faster loads

Per `.cursor/plans/saas_phased_rollout_76d6de54.plan.md`.

| Deliverable | Implementation |
|-------------|----------------|
| Schema | `scheduleTemplates/{weekday}` + `slotsSummary[]` |
| Blocks | `scheduleTemplates/{weekday}/blocks/{slotId}` |
| Admin | Summary listener → `loadBlockForSlot` on click (`admin.html`) |
| Player | `subscribeCalendarDay` / `subscribeTemplateDay` + **one** `onSnapshot` on active block doc (`index.html`) |
| Bootstrap | `writeTemplateDay` — no embedded `blocks[]` on template header |
| Rules | `firestore.rules` — `blocks/{slotId}` under templates |
| Indexes | No new collectionGroup queries |
| Boot perf | `meta.syncVersion`; `startFamilyApp` skips await when `meta.seeded` |
| E2E | `tests/e2e/schedule-lazy.spec.js` (admin list-before-detail timing + player slots) |
| Migration (emulator) | `npm run migrate:template-blocks` → `scripts/migrate-template-blocks.mjs` |

**Gate:** All Playwright tests pass → your approval before Phase 3 sign-off.

### Phase 3 — Real calendar days (dated schedule)

Per `.cursor/plans/saas_phased_rollout_76d6de54.plan.md`.

| Deliverable | Implementation |
|-------------|----------------|
| Schema | `calendarDays/{dateKey}` + `blocks/{slotId}`; `dateKey` = `en-CA` in family timezone |
| Materialize | `ensureCalendarDay` / `materializeCalendarDayFromTemplate` (`calendar-store.js`) |
| Admin | `selectDate` → `calendarDays/{dateKey}`; AI retune/draft/quality pass `dateKey` when a date is selected |
| Sprint | `activeSprint`: `{ dateKey, activeDay, activeSlot, status }` |
| Player | Today's `calendarDay` via `dateKey`; slot listener on one block doc |
| Functions | `retune-day`, `draft-day`, `quality-check-day` read/write calendar when `dateKey` sent |
| Unit | `tests/date-utils.test.js` — timezone + `dateKeyForWeekdayNearToday` |
| E2E | `tests/e2e/calendar-day.spec.js` — admin dated list + player sprint |

**Gate:** All Playwright tests pass → your approval before Phase 4 sign-off.

**Verify after deploy**

1. Admin → pick a date on the calendar → `actHead` shows that calendar date (not only weekday template).
2. Player → activity titles match that date's `calendarDays` doc (materialized from template on first open).
3. Firestore → `families/{id}/calendarDays/YYYY-MM-DD/blocks/{slot}`.

### Phase 4 — Members, roles, superadmin

Per `.cursor/plans/saas_phased_rollout_76d6de54.plan.md`.

| Deliverable | Implementation |
|-------------|----------------|
| Roles | `owner`, `parent`, `viewer` on `members/{uid}`; rules `canWriteFamily` / `canManageFamily` |
| Invites | `invites/{inviteId}` + `invite-service.js`; owner UI on `settings.html` |
| Admin UI | Viewers: disabled controls; `canEditSchedule()` on form open/save |
| Superadmin | `platformRole` claim; `platform.html` |
| Functions | `verifyFamilyRequest` — writes require `owner` or `parent` |
| E2E | `tests/e2e/members-roles.spec.js` |

**Gate:** All Playwright tests pass → your approval before Phase 5 sign-off.

**Verify after deploy**

1. Owner → Settings → invite → co-parent opens link and sees the same planner.
2. Viewer → read-only (edit buttons disabled).
3. Superadmin → `/platform.html` after claim; other users denied.

### Phase 5 — Provider (“homeschool service”) account

Per `.cursor/plans/saas_phased_rollout_76d6de54.plan.md`.

| Deliverable | Implementation |
|-------------|----------------|
| Signup fork | `login.html` — “Start as a family” vs `?mode=provider` for programs/tutors |
| Schema | `providers/{providerId}` + `members/{uid}`; `families/{id}.providerId` |
| Dashboard | `provider.html` + `provider-service.js` — add family, parent invite, list |
| Rules | `providerCanAccessFamily` read/write; providers create invites + billing stub |
| Billing | `families/{id}/billing/subscription` stub (`status: stub`) |
| E2E | `tests/e2e/provider.spec.js` |

**Gate:** All Playwright tests pass → SaaS foundation complete.

**Verify after deploy**

1. Sign in via **For programs and tutors** → create a family + parent email → share invite link.
2. Parent opens link, signs in, sees normal family planner (no provider nav on family pages).
3. Parent cannot read another family’s data.

**Verify after deploy (Phase 2)**

1. Admin → school day → titles fast → click activity → detail hydrates.
2. Player → slot dropdown from summary → one activity loads at a time.
3. Firestore: blocks in subcollection, not a giant `blocks[]` on the template doc.

## Deploy commands

```bash
firebase deploy --only hosting,firestore:rules,firestore:indexes
firebase deploy --only functions
```

## E2E (local)

```bash
npm run test:e2e
```

This starts Firestore + Auth + Hosting emulators (fresh rules), seeds test data, runs Playwright, then tears down.

If emulators are already running on ports 8080/9099/5000, stop them first or use:

```bash
npm run test:e2e:local
npm run test:e2e:cleanup
```

## Superadmin claim (Phase 4)

```bash
# After creating your user in production Auth:
node -e "
const admin=require('firebase-admin');
admin.initializeApp();
admin.auth().setCustomUserClaims('YOUR_UID',{platformRole:'superadmin'}).then(()=>console.log('ok'));
"
```

Then open `/platform.html` — families list plus **platform-wide** LLM system instructions and bot model settings (`platform/llm_config`). Families cannot read or edit this document.

On first Cloud Function call after deploy, legacy `system/llm_config` (and any family copies) are migrated into `platform/llm_config` automatically. Superadmin can also use **Restore full LLM defaults** on the platform page.

## LLM tenancy (invariant for Phases 4–5)

When adding providers, bots, or new call sites, preserve this split:

1. **Platform-wide (superadmin only):** LLM *configuration* — system instructions, bot model IDs, temperature, thinking budget, etc. Stored at `platform/llm_config`. Families cannot read or edit. Loaded globally via `loadPlatformLlmConfig` (`functions/platform-llm.js`).

2. **Per-family (tenant-scoped):** LLM *runtime grounding* — every API call must inject **only that family's** data: children profiles, ledger/scores, intercom chat history, observations, skills registry, schedule/calendar context. Must **never** leak or mix data from other families.

3. **Existing implementation:** `buildGroundedSystemPrompt(familyId)` in `functions/index.js` composes platform instructions with family-scoped Firestore reads keyed by `familyId`. `loadPlatformLlmConfig` is global. Treat this as the invariant for future phases (multi-family providers, new bots, etc.).

## Fresh production cutover

Root collections (`crew`, `schedule`, …) are retired. First parent signup runs family onboarding and seeds `families/{familyId}/…`.
