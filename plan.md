# Dar-al-Hikmah OS — Rebuild Plan (Vue 3 + Firestore + GCP)

> **Scope decision (2026-06-14):** Full rewrite from scratch. Frontend: **Vue 3 + Vite + Pinia + Vue Router**. Backend: **Firebase (Firestore + Cloud Functions for Firebase, gen 2) + GCP services (Vertex AI / Gemini, Cloud Tasks, Cloud Storage)**. The existing local code in `D:\homeschooling` is kept only as a *reference* for proven patterns and is not carried forward verbatim.
>
> **Reuse-as-reference (do not copy blindly, but mine for design):** the prior Firestore tenant model (`db-paths.js`), the curriculum/ReAct/analytics/guide agent designs, exposure & observation fan-out, Quran/Noorani/Arabic audio handling, and the fake-data seeder.
>
> **Known gotcha (carry forward):** Gemini `gemini-2.0-flash` 404s on this key. Use `gemini-2.5-flash` with `thinkingBudget: 0` and `maxOutputTokens >= 1024`. Firebase project shell `homeschooling-b3e57` still exists (data wiped 2026-06-11).

---

## 1. Goals & non-negotiables

A multi-tenant homeschooling operations platform where each **family** is an isolated tenant. Parents define a guiding philosophy, the system's AI agents generate a 6-month curriculum + syllabus of activities, parents plan activities into a weekly calendar, and parents/children run activities in a dedicated player. Scoring is completion-focused (never sibling-comparative) and supports interdependent co-op activities.

**Invariants that must never break:**

1. **Tenant isolation.** No family can ever read or write another family's data. Every Firestore read in a Cloud Function is keyed by `familyId` derived from a verified auth token, never from client-supplied input alone.
2. **LLM config tenancy split.** Platform-wide LLM *configuration* (system instructions, model IDs, temperature) lives at `platform/llm_config` (superadmin only). Per-family LLM *grounding* (children profiles, scores, observations, schedule) is injected per request and never mixed across families.
3. **Assessment philosophy.** Scoring measures *completion of the assigned task*, not excellence, and never ranks one child against another. Co-op scoring rules are first-class.
4. **AI agent safety.** "All-powerful" CRUD agents act only within the caller's family tenant and role, every mutation is logged to an audit trail, and destructive batch operations are previewed before apply.

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Vue 3 SPA (Vite, Pinia, Vue Router)  →  Firebase Hosting     │
│   - Auth views, Family/Profile, Skills, Curriculum chat,      │
│     Syllabus, Activity Planner (drag-drop), Activity Player,  │
│     Super Admin, per-user dashboards                          │
└───────────────┬─────────────────────────────────┬────────────┘
                │ Firebase SDK (onSnapshot, auth)  │ HTTPS callable / REST
                ▼                                   ▼
┌───────────────────────────┐      ┌──────────────────────────────────┐
│  Cloud Firestore           │      │  Cloud Functions for Firebase     │
│   families/{id}/...        │◄─────┤   - callable: agent endpoints     │
│   users, providers,        │      │   - HTTP: media/audio/image       │
│   platform/llm_config      │      │   - scheduled: cron agents        │
│   _agent_index (DB map)    │      │   - Cloud Tasks workers           │
└───────────────────────────┘      └───────────────┬──────────────────┘
                                                    ▼
                          ┌──────────────────────────────────────────┐
                          │ GCP: Vertex AI (Gemini), Cloud Tasks      │
                          │ (long agent jobs), Cloud Storage (images, │
                          │ audio, Arabic qira'at library)            │
                          └──────────────────────────────────────────┘
```

- **State:** Pinia stores wrap Firestore listeners (auth, family, children, skills, curriculum, calendar, player). Components stay thin.
- **Security:** Firestore Security Rules enforce tenancy + roles at the database; Cloud Functions re-verify on every privileged action (defense in depth).
- **Long-running AI work** (6-month syllabus generation) runs as enqueued **Cloud Tasks** jobs with progress documents the UI subscribes to — never blocking an HTTP request.

---

## 3. Data model (Firestore)

Top-level: `users/{uid}`, `providers/{providerId}`, `platform/{doc}`, `families/{familyId}`.

Under `families/{familyId}/`:

| Collection / doc | Purpose |
|---|---|
| `meta/app` | seed/sync flags, timezone, feature toggles |
| `members/{uid}` | role (`owner` \| `parent` \| `viewer`), display name |
| `profile/family` | family name, **main guiding light** (textarea), combined-vs-individual goal mode |
| `guardians/{gid}` | parent/guardian profile: DoB, occupation, mother tongue, education budget, income, location, city facilities, likes, dislikes, goals (per-child or combined) |
| `children/{childId}` | DoB, strengths, weaknesses, comments |
| `skills/{skillId}` | family-selected skills (mirrored to global registry); bound per-child via `childSkills` |
| `children/{childId}/skills/{skillId}` | per-child skill tracking |
| `curriculum/{curriculumId}` | 6-month plan: objectives, content, instruction, assessment; status (`drafting`/`active`); guiding-light snapshot |
| `curriculum/{id}/subjects/{subjectId}` | macro subject goals, competencies, grading standards |
| `activities/{activityId}` | generated syllabus activity: type, subject, complexity rank, target child(ren), parent instructions (mother-tongue transliteration), example walkthrough, scoring config, co-op mode, media refs |
| `calendarDays/{dateKey}/blocks/{slotId}` | planned day instances (drag-drop output); per-child or group slot assignment |
| `scheduleTemplates/{weekday}/blocks/{slotId}` | reusable weekly template |
| `scores/{scoreId}` | completion-based scores; co-op linkage (`drivingChildId`, `sharedSuccess`) |
| `observations/{obsId}` | parent observations, bound to authoring `uid` (+ denormalized mirrors per child/guardian) |
| `exposures/{eventId}` + `contentStats/{atomKey}` | append-only exposure log + rollup counters (what content each child has seen) |
| `_agent_index/{collectionKey}` | **DB pointer index** for AI agents: schema map describing which data lives where, field shapes, sample doc IDs, counts (see §5) |
| `agentRuns/{runId}` | agent job status, plan steps, progress, audit of mutations |
| `intercom/{msgId}` | chat history for guide/curriculum agents |
| `invites/{inviteId}`, `billing/subscription` | membership invites, billing stub |

Platform: `platform/llm_config` (superadmin-only LLM config). Global skills catalog is a **top-level collection** `skillRegistry/{skillId}` (readable by any signed-in user; written server-side when a family manager adds a skill).

**Activity types** (drive UI provisioning): `quran`, `noorani_qaida`, `story_reading`, `mathematics`, `computer`, `ai_robotics`, `physical`, `teaching`. Each type maps to a typed `featureConfig` consumed by the Activity Player renderer.

---

## 4. AI agent system

A unified agent runtime, specialized by role. All agents share: (a) a **tool layer** over Firestore, (b) the **agent DB index** for cheap orientation, (c) per-family grounding, (d) an audit log.

### 4.1 Tool layer (Firestore tools the LLM can call)
- `queryCollection(collectionKey, filters, limit, cursor)` — paginated, tenant-scoped reads.
- `getDoc(path)` / `listDocs(collectionKey)` — pointer-driven fetches.
- `createDoc` / `updateDoc` / `deleteDoc` / `batchWrite` — CRUD, role-gated, audited, with **preview-before-apply** for batch/destructive ops.
- `readContext(handle, range)` — read from a previously fetched large result set held in a context store (see §4.3).

### 4.2 Agent classes
| Class | Trigger | Examples |
|---|---|---|
| **Goal-based (interactive)** | user chat | Curriculum agent (interviews parents, builds 6-mo plan around guiding light); Syllabus agent (subject-by-subject activity generation, basic→deep) |
| **Guide** | user chat | Helps a user navigate their allowed data, explains stats |
| **CRUD / power** | user command | Atomic-level create/read/update/delete across the tenant, audited |
| **Scheduled (cron)** | Cloud Scheduler | Nightly archive, weekly ledger rollup, exposure rollups, curriculum-progress nudges |
| **Master/slave** | orchestration | A master plans + delegates subject-generation to slave workers running in parallel via Cloud Tasks |

### 4.3 Massive-data fetch + read mechanism (the "smartest way")
Combine three techniques rather than one:
1. **Agent DB index (`_agent_index`)** — a maintained map ("families/{id}/children → {fields, count, sampleIds}") so agents know *where* data is without scanning. Kept fresh by Firestore triggers that update index counters on writes (the "simultaneously updating fetching/reading system" requirement).
2. **Iterative goal-based query plan** — for big tasks the agent emits a small plan of query steps, executes one chunk, analyzes, decides the next step (ReAct loop). Avoids loading everything at once.
3. **Chunked fetch + context handles** — when a large set is genuinely needed, it's fetched in pages into a server-side **context store** (Firestore/Storage), and the agent reads slices via `readContext(handle, range)` instead of stuffing the whole payload into the prompt.

### 4.4 Syllabus generation (master/slave, long-running)
- Master agent reads curriculum subjects + child profile + guiding light, produces a per-subject generation plan.
- One slave job per subject runs as a Cloud Task; each slave generates a complexity-graded activity series (basic → deep over 6 months), **aware of already-generated activities in that subject** (reads `activities` filtered by subject before extending).
- Progress streamed to `agentRuns/{runId}`; UI shows a live progress board.

---

## 5. Feature modules (Vue)

1. **Auth** — email/password + Google; route guards by role; `access-disabled` screen for disabled families.
2. **Super Admin** (`/platform`) — enable/disable families, manage family users, delete family + all data (callable that recursively purges the tenant), platform LLM config editor.
3. **Family setup & profile** — family name, **main guiding light**, goal mode; onboarding wizard on first signup.
4. **Members** — guardians (full profile fields) and children (DoB, strengths, weaknesses, comments); per-user dashboards scoped to access level + own performance stats.
5. **Skills** — select from global registry or add new (added by family manager, mirrored globally), bound per-child, tracked individually; feeds curriculum/syllabus.
6. **Curriculum builder** — guided chat agent → 6-month plan with Objectives / Content / Instruction / Assessment; guiding-light weighted; per-subject macro goals & grading.
7. **Syllabus builder** — master/slave activity generation per subject; live progress; activity library grouped by subject and ordered by complexity.
8. **Activity Planner** *(new)* — weekly drag-drop board: pool of activities grouped by subject (ordered by complexity), drop into day/time slots from a chosen calendar date forward; per-child planning; group activities assignable to all children at once; reorder via drag. AI-assisted "auto-plan my week" option.
9. **Activity Player** *(new)* — runs an activity. **Parent view** (authenticated): instructions in mother-tongue transliteration, example walkthrough, scoring section (incl. co-op/driving-group rules), observations section bound to logged-in parent. **Child view** (link opened in incognito / non-logged-in device): the activity *content* renderer — large fonts, AI storybook image, tap-a-word audio, Arabic word/verse qira'at from a Storage library; zoomable text.
10. **Per-activity-type renderers** — Quran, Noorani Qaida, story reading, math, computer, AI/robotics, physical, teaching.
11. **Dummy data** — seeder Cloud Function generating realistic families, guardians, children, skills, curriculum, activities, scores, observations as a test baseline.

---

## 6. Implementation phases (each: build → test → gate for approval)

**Why phased, not one-shot:** the build spans ~10 distinct subsystems with independent failure modes; the riskiest parts (master/slave syllabus over Cloud Tasks, the massive-fetch agent mechanism, the link-scoped child player) will be partly wrong on the first design and must be hit in isolation, not tangled in a monolithic diff. Invariants (tenant isolation, completion-only/co-op scoring) can only be *proven* on a small stable base before more code piles on. Phasing also lets spend (GCP/LLM tokens) be approved per stage, and gives a look-and-react loop for the still-open UX (planner drag-drop, player dual view).

### Checkpoint grouping (where I stop for your sign-off)

The 10 phases roll up into **4 approval checkpoints** so you approve 4 times, not 10. Each phase still runs its own internal build→test cycle; checkpoints are the points where work pauses for explicit approval before continuing.

| Checkpoint | Phases | What you can see / use at the gate |
|---|---|---|
| **A — Foundation** | 0–2 | Log in, set up a family, add children & skills. Cross-tenant isolation tests green. **First clickable app, not slideware.** |
| **B — Brain** | 3–5 | Chat to generate a curriculum; watch a 6-month syllabus build live. |
| **C — Daily loop** | 6–7 | Drag activities into a week; run one activity as parent and as child. |
| **D — Ops** | 8–10 | Super-admin controls, scheduled rollups, seeded dummy-data baseline, full test sweep. |

### Phases

| Phase | Deliverable | Key tests |
|---|---|---|
| **0. Scaffold** ✅ | Vite + Vue 3 + Pinia + Router project; Firebase init; emulator suite; CI test scripts; folder structure | App boots against emulators; lint/typecheck pass — **DONE 2026-06-14** (old app archived to `legacy/`; web + functions build & tests green; dev server renders clean) |
| **1. Auth + tenancy** ✅ | Login/onboarding, `families/{id}` model, members/roles, Security Rules, route guards | Rules unit tests (cross-tenant denied); auth E2E — **DONE 2026-06-14** (email/Google sign-in, `createFamily` callable, onboarding wizard, role-gated rules; 14 rules tests + 10 Playwright E2E green) |
| **2. Profiles + skills** ✅ *(→ Checkpoint A)* | Family profile (guiding light), guardians, children, skills (global registry + per-child binding) | CRUD + rules tests; skill-binding test — **DONE 2026-06-14** (profile/guardian/child editors, skills module w/ `createGlobalSkill` callable + per-child binding matrix; 16 rules + 13 E2E green) |
| **3. Agent runtime** ✅ | Tool layer, `_agent_index` + trigger maintenance, grounding, audit log, guide agent | Tool unit tests; index-freshness test; isolation test — **DONE 2026-06-14** (Gemini-pluggable ReAct loop, tenant-scoped Firestore tools w/ role gating + audit, context-handle paging, live `_agent_index` triggers, grounded prompts, read-only `askGuide` callable + chat UI; 12 functions-unit + 12 agent-integration + 14 E2E green) |
| **4. Curriculum agent** ✅ | Interactive chat → 6-mo plan (objectives/content/instruction/assessment), guiding-light weighting | Curriculum E2E; guiding-light influence test — **DONE 2026-06-14** (`askCurriculum` callable + `runCurriculum` core; `finalize_curriculum` tool batch-writes `curriculum/{id}` + `curriculum/{id}/subjects/{id}`; grounded system prompt weights guiding light; multi-turn history via Gemini contents format; CurriculumView chat+panel UI; 4 agent-integration + 4 Playwright E2E green) |
| **5. Syllabus (master/slave)** ✅ *(→ Checkpoint B)* | `generateSyllabus` onCall + `runSyllabus` master + `runSyllabusWorker` per-subject; 4-6 complexity-graded activities each; live progress via `agentRuns/{runId}` onSnapshot; SyllabusView grid grouped by subject with rank badges; `activities` Pinia store | 3 agent-integration + 4 Playwright E2E green — **DONE 2026-06-14** |
| **6. Activity Planner** ✅ | Drag-drop weekly board + schedule modal; `calendarDays/{dateKey}/blocks/{id}` materialization; `usePlannerStore` with 7 per-day `onSnapshot` listeners; week navigation; `PlannerView.vue` with left activity pool + right day grid; `scheduleTemplates` rule added | 4 Playwright E2E green — **DONE 2026-06-14** |
| **7. Activity Player** ✅ *(→ Checkpoint C)* | `ActivityView.vue` (parent view: instructions, child link, scoring with co-op/driver, observations); `ChildPlayerView.vue` (public, token-scoped, per-type renderer); `playerTokens/{uuid}` family-scoped with compound URL token `{familyId}.{tokenId}`; `player.js` service (createPlayerToken, submitScore, addObservation, updateBlockStatus); "Run →" links on planner blocks and syllabus cards | 4 Playwright E2E green — **DONE 2026-06-14** |
| **8. Super Admin** | Enable/disable, manage users, delete family + data; platform LLM config | Platform E2E; recursive-delete test; LLM-tenancy test | *(skipped — post-launch)* |
| **9. Scheduled agents** | Cron rollups (ledger, exposure, archive, nudges) | Scheduled-fn unit tests | *(skipped — not needed at family scale)* |
| **10. Dummy data + full pass** ✅ *(→ Checkpoint D)* | `createDemoData` + `seedDemoFamily` callable; 20 activities across 4 subjects; 10 calendar blocks; scores + observations; composite Firestore indexes; `--test-concurrency 1` for agent test isolation | 15 unit + 16 rules + 22 agent + 30 E2E = **83 tests green** — **DONE 2026-06-14** — **Deployed to https://homeschooling-b3e57.web.app** |

**Gate rule:** each phase ends with passing tests; work pauses for your explicit approval at the **4 checkpoints (A–D)** above before the next group is treated as done.

---

## 7. Testing strategy

- **Unit (`node --test`)** — pure logic: agent tools, query-plan builder, scoring rules (completion + co-op/driving), complexity ordering, date/timezone utils, guiding-light prompt assembly, Arabic/Quran/Noorani helpers.
- **Security Rules (`@firebase/rules-unit-testing`)** — cross-tenant read/write denied; role gating (viewer read-only); platform config family-inaccessible; invite rules.
- **Function/integration (emulator `emulators:exec`)** — agent CRUD audited & tenant-scoped; curriculum/syllabus generation; recursive family delete; exposure/observation fan-out; dummy-data seeding.
- **E2E (Playwright)** — auth & onboarding; profile/skills; curriculum chat; syllabus progress; **planner drag-drop**; **player dual view** (authed parent vs incognito child, verified via separate browser context); scoring & observations; super-admin.
- **CI** — `npm test` runs unit + rules + emulator E2E with fresh seed/cleanup, mirroring the prior project's emulator harness.

---

## 8. Open items / risks

- **Vertex AI vs direct Gemini API** — decide auth path; Vertex preferred on GCP for IAM + quotas. (Carry the `gemini-2.5-flash` / `thinkingBudget:0` gotcha.)
- **Arabic qira'at library** — source/license word-by-word audio; store in Cloud Storage with a manifest.
- **Incognito "child view" detection** — implement as an unauthenticated, signed, link-scoped player route (token in URL granting read-only content for one activity), not by sniffing incognito; this is robust and secure.
- **Cost controls** — token budgets per agent run; Cloud Tasks concurrency caps on slave workers.
- **Blaze plan** required for Cloud Functions + Tasks + Vertex.

---

## 9. Proposed repo structure

```
/                      # Firebase config (firebase.json, *.rules, indexes)
/web                   # Vue 3 + Vite app
  /src
    /router /stores /views /components /lib (firebase, agent-client)
    /modules (auth, family, skills, curriculum, syllabus, planner, player, admin)
/functions             # Cloud Functions (gen 2)
  /agents (runtime, tools, index, curriculum, syllabus, guide, crud, scheduled)
  /media (story-image, speech, quran, noorani, arabic)
  /platform (llm-config, family-delete, fake-data)
/scripts               # seed / e2e harness / migrations
/tests                 # unit + rules + e2e (Playwright)
/docs                  # this plan + ADRs
```
