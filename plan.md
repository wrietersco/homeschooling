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

## Epic 2 — Quran taxonomy grounding & platform library (started 2026-06-17)

All work on branch `epic2-quran-taxonomy-grounding`. Deployed to https://homeschooling-b3e57.web.app. **Do NOT push to GitHub** (user instruction).

### E2-A: 8-request Arabic/content feature batch — DONE & DEPLOYED 2026-06-18

1. **Per-agent LLM config** — `functions/agents/agentConfig.js`; `loadAgentConfig(db,key)` deep-merges defaults ⊕ stored; agents now actually read config (was `process.env.GEMINI_MODEL`); PlatformView LLM tab rebuilt.
2. **Gemini TTS** — `functions/agents/tts.js`; `synthesizeSpeech` callable; PCM→WAV; Storage `tts-cache/{sha}.wav`; `useSpeech.js` server-first with browser fallback.
3. **Indo-Pak Arabic font** — Scheherazade New self-hosted (`public/fonts/`); `.font-arabic` class.
4. **Word-click TTS bug fix** — removed per-text `serverFailed` blacklist; transient errors now fall back for that tap only.
5. **Word-by-word EN/UR glosses** — `en`/`ur` on qaida + quran word objects; "Show meaning" toggle in ActivityContent.vue.
6. **Dialogue content type** — `conversation` activity type; `dialogue` content kind; chat-bubble renderer; per-speaker voice palette; `speakSequence`.
7. **Anti-repetition** — `usedPassages` ledger in `meta/contentUsage.recent`; VARIETY system prompt block.
8. **Mother-tongue parent instructions** — `parentInstructionsTranslit`/`parentInstructionsNative` on activities; "In your language" block in ActivityView + ActivityPlayerView.
9. **Per-child performance in grounding** — `summarizeChildPerformance` (scores + observations) injected into all agents and syllabus/content workers.
10. **Player child-attribution** — ActivityPlayerView shows "For \<child chips\>" row.
11. **Planner search/filters** — search box + type + child dropdowns in PlannerView pool.
12. **Syllabus progression flowchart** — per-subject rank-ordered horizontal flow in SyllabusView.
13. **Auto-schedule agent** — `functions/agents/scheduler.js`; `autoSchedule` callable; guardian availability (weekday ranges); PlannerView "✨ Schedule via agent".
14. **Lifecycle deletes** — `deleteCurriculum`/`deleteSyllabus` callables; delete buttons in CurriculumView, SyllabusView, PlatformView.
15. **Guide agent on Activity Player** — floating dock FAB in ActivityPlayerView; per-guardian sessions (`intercom/{uid}/messages`); `context` param; `GuideChat.vue` reusable component.

### E2-B: Stability hardening pass (18 audit fixes) — DONE & DEPLOYED 2026-06-19

Removed `testImageGen`/Phase-0 `agent` endpoint; `quranSource.js` per-surah bundle cache; syllabus failure-loop fix (`MAX_SUBJECT_ATTEMPTS=3`); disabled-family enforcement; player token expiry (Firestore rule + `maintenance.js` reaper); `llm.js` retry/backoff; rate limiting (`rateLimit.js`); `FieldValue.serverTimestamp()` → `new Date()` fix; Storage bucket default fix; TTS inline cap (1.5 MB); contextual console.warn.

### E2-C: Content management — DONE & DEPLOYED 2026-06-19–21

- **Stop buttons** — `stopContentBackfill`/`stopSyllabus` callables; Stop/Resume UI on ContentBackfill.vue and SyllabusView.
- **Picture-naming images** — `generateObjectImages` in `imageGen.js`; `imageSubject` on vocab/qaida items; object-style image gen; picture card grid renderer.
- **Embedded stories** — `tips` kind rewritten to emit full `story`/`discussionQuestions` (never tell parent to "find a story"); tips renderer in ActivityContent.vue.
- **Force regenerate** — `requestContentBackfill({force, subjectId, types})`; `forceToken` convergence; "Regenerate all" + "Regenerate by type" chips in SyllabusView.

### E2-D: Activity differentiation — DONE & DEPLOYED 2026-06-25

- **Audit** — read-only `auditActivityDifferentiation` callable; "Differentiation audit" section in SyllabusView. Result on live data: 341 activities → 43 split + 46 review.
- **Per-child variants** — `differentiateActivities` callable (`functions/platform/differentiate.js`); `contentByChild[childId]` field; `differentiatedLevels`; LLM infers level from strengths/weaknesses/scores. Parent ActivityPlayerView renders `contentByChild[activeChildId]` with fallback to shared `content`.
- **Child share-page differentiation (DONE 2026-06-25):** `createPlayerToken` (`web/src/services/player.js`) takes an optional `forChild` ({id,name,level}); when the activity has `contentByChild[forChild.id]` it embeds that child's variant + `forChildId`/`forChildName`/`differentiatedLevel` and scopes `targetChildren` to that child. ActivityView "Child Link" section now renders one Generate/Copy link **per differentiated child** (`differentiatedChildren`), falling back to the single shared link for undifferentiated activities. ChildPlayerView shows a "For \<name\>" + level badge under the title. Build clean; both views render without console errors. NOT yet emulator/E2E-exercised (needs seeded differentiated activity).

### E2-E: Super Admin platform tooling — DONE & DEPLOYED 2026-06-25

- **Model tooling** — `getModelCatalog`/`previewModel`/`testAllModels` callables; "Models" tab in PlatformView.
- **Cost metering** — `functions/lib/costMeter.js`; per-call cost events (`costEvents/{path}`); family + platform rollups (`costRollups/{path}`, `platformCostRollups/{period}`); `getCostOverview`/`getFamilyCostDetail` callables; "Costs" tab in PlatformView.
- **Knowledge brief** — `functions/agents/knowledgeBrief.js`; `rebuildKnowledgeBrief`/`getActivityJourney` callables; triggers on activities/curriculum/blocks; `meta/knowledge_brief`.
- **Skill mapping** — `functions/agents/skillMap.js`; `requestSkillMap` callable; links children ↔ skills ↔ activities; repairs activity→child bindings.
- **Content planning agent** — `functions/agents/contentPlan.js`; `requestContentPlanning`; per-subject learning arc at `subjectPlans/{subjectId}`.
- **Guide chat history clear** — `clearGuideHistory` callable.

### E2-F: Quran + Noorani Qaida platform library — DONE & DEPLOYED 2026-06-25

- **Full-Quran import** — `functions/platform/quranImport.js`; `importQuran`/`getQuranStatus` callables; shared `quran/{surah}` collection; superadmin-only write; any signed-in read.
- **Noorani Qaida corpus** — `functions/agents/qaidaCorpus.js`; 449 items / 12 lessons (letters, joined, zabar/zer/pesh, tanween, madd, khari-harakat, leen, jazm, tashdeed, tashdeed-combos); `functions/agents/qaidaSpell.js` deterministic spell-out engine with Madd fusion + standing harakat; shared `nooraniQaida/{lessonId}` collection.
- **Qaida import + audio** — `functions/platform/qaidaImport.js`; `importQaida`/`getQaidaStatus` (idempotent, prunes orphans, preserves audio by glyph+script); `requestQaidaAudio`/`stopQaidaAudio`/`qaidaAudioWorker` (background job, concurrency=1, batch=15, quota-aware); `regenerateQaidaWord`; `deleteQaidaLibrary`/`deleteQaidaAudio`. Audio reuses `tts-cache/{sha}.wav`.
- **TTS quota** — `functions/platform/quota.js`; `DEFAULT_QUOTA` (RPD per model); `platformBudget`/`familyBudget` allocation; `enforceFamilyTtsQuota` + `platformTtsRemaining`; `getQuotaConfig`/`setQuotaConfig` callables; "Quota" tab in PlatformView. Wired into `synthesizeSpeech` (family) + `qaidaAudioWorker` (platform reserve).
- **Usage dashboard** — `functions/platform/usageDashboard.js`; `getUsageDashboard` callable; TTS daily counter (`platform/usage/daily/{day}`); alerts (danger/warn/ok); 14-day trend; Qaida job state; monthly cost rollup; "Usage" tab in PlatformView.
- **Qaida job UX** — live onSnapshot on `platform/qaidaAudioJob`; "paused" state after 3 quota-walled passes; "Restart audio" / "Delete audio" buttons; amber pause indicator.
- **Firestore rules** — `nooraniQaida/{doc=**}` signedIn-read/superadmin-write; `platform/quota` superadmin read/write.
- **Test counts after E2-F:** 160 functions-unit + 26 web vitest green.

### E2-L: Live Qaida audio resolution (auto-attach over time) — DONE & DEPLOYED 2026-06-26

Made qaida activities pick up recordings as the platform voices them over days/weeks, with **zero regeneration** — closing the gap that embedded audio was a snapshot frozen at content-generation time.
- **`firestore.rules`** — `nooraniQaida/{doc=**}` read is now **public** (`if true`), so the unauthenticated child player can resolve audio live. User-approved: standard non-sensitive Qaida content + already-public Storage audio URLs, and replaying cached audio is free.
- **`web/src/composables/useQaidaLibrary.js`** (new) — given qaida content, collects distinct `materialRef.lessonId`s, fetches those `nooraniQaida/{lessonId}` docs once (session-cached), and exposes `liveAudioUrl(it)` / `liveSpellScript(it)` that prefer the library's CURRENT recording, falling back to the embedded snapshot, then TTS. Best-effort (silent fallback on any read failure).
- **`web/src/components/ActivityContent.vue`** — the qaida renderer (`reciteGlyph`, `.glyph-lib` accent, 🎧/🔊 icon, spell-script caption) now uses the live resolvers. Same component serves parent + child players, so both auto-upgrade.
- **Effect:** regenerating the syllabus is now decoupled from audio timing — content can be (re)generated any time (audio mostly TTS at first), and each glyph silently switches to its recording the moment the platform voices it, no further processing. Only activities generated since E2-G carry `materialRef`, so a one-time syllabus/content regen seeds the references.
- **Tests:** ActivityContent.qaida.test.js (+1 auto-upgrade case via mocked live resolver). **194 functions-unit + 32 web vitest green, web build clean.**
- **Deployed 2026-06-26:** firestore:rules + hosting (no functions change — `materialRef` already embedded since E2-G).

### E2-K: Qaida audio self-pacing (never throttle, auto-resume) — DONE & DEPLOYED 2026-06-26

The audio worker was crawling into Google's free-tier TTS wall (100 RPD / 10 RPM; user hit 114/100 + 14/10) then hard-pausing for a manual restart. Replaced with a self-managed rate limiter.
- **`functions/platform/qaidaImport.js`** — `VOICE_BATCH=4` real syntheses per pass, `PASS_INTERVAL_MS=2h` between passes (~`SAFE_DAILY_TARGET≈48`/day), `PER_CALL_DELAY_MS=3000`. Pure exported `gentlePassDue(job, nowMs)` is the limiter; the every-1-min scheduled worker claims only when a pass is due, else no-ops. `synthToStorage` returns `{url, cached}` so cached scripts apply free and don't consume the batch. `runQaidaAudioPass` ALWAYS re-queues (removed `paused`/`MAX_QUOTA_PASSES`/`MAX_STALL_PASSES`) so it auto-resumes across days with no restart; platform-reserve-exhausted backs off one interval instead of erroring. `recordTtsUsage` now logs real API calls (not free cache hits). "Restart audio" resets the pacing timer and voices a 4-clip primer immediately.
- **`web/src/views/PlatformView.vue`** — active message shows `qaidaJob.pacing`; helper text explains ~48/day auto-resume, no restart needed.
- **Tests:** qaidaAudio.test.js (+3 `gentlePassDue`). **189 functions-unit green, web build clean.**
- **Deployed 2026-06-26:** functions qaidaAudioWorker, requestQaidaAudio, regenerateQaidaWord + hosting. 449 clips fully voice in ~9-10 days, automatically.

### E2-J: Differentiation generalised beyond the Qaida pilot — DONE & DEPLOYED 2026-06-26

The differentiation apply phase now covers EVERY clubbed activity (using E2-H's authoritative `targetingMode`), not just Noorani Qaida by type.
- **`functions/platform/differentiate.js`** — candidate selection replaced the hand-rolled `type+skillPaced+!coop` filter with the pure, exported `isDifferentiationCandidate(activity, typeSet)` = `!contentByChild && (typeSet empty || matches type) && classifyActivity(activity).clubbed`. `classifyActivity` honours the content plan's `targetingMode` when set (heuristic otherwise), so a `teaching` activity the old filter ignored is now differentiated when the plan marks it individual. `runDifferentiation` + the callable now default `types` to `[]` (all flagged) instead of `["noorani_qaida"]`.
- **`web/src/views/SyllabusView.vue`** — refactored `differentiateQaida` into a generic `differentiate(types, label)`; added a **"Differentiate all flagged (N)"** primary button (covers every clubbed activity, count from `auditPlan.summary.toSplit`, disabled when zero) beside a **"Noorani Qaida only"** secondary button.
- **Tests:** `functions/test/differentiate.test.js` (new, 8 — covers type filter, already-differentiated skip, single-child skip, `targetingMode` individual/shared override, null-safety). **186 functions-unit + 31 web vitest green, web build clean.**
- **Deployed 2026-06-26:** function differentiateActivities + hosting. CAVEAT: `targetingMode`-driven candidates only appear after a content-planning re-run (else the type+co-op heuristic still applies, which is the prior pilot behavior). Each differentiated activity is per-child content + image gen (slow) — the client loops one-per-call.

### E2-I: Scheduler consumes the material meta — DONE & DEPLOYED 2026-06-26

The auto-scheduler now reads each activity's `plan.material` (from E2-H) to place repeatable work multiple times and split individually-paced work per child.
- **`functions/agents/scheduler.js`** — pure `weeklyRepeatTarget(material)` (daily→5 weekday placements, weekly/biweekly/monthly/non-repeatable→1) + `describeMaterialForPool(material)` append a `· repeat daily (aim ~5×/week) · individual — one session per child` suffix to each pool line. New SCHEDULING-PRINCIPLES block tells the agent to place repeatable items ~N×/week (the "⚠ already scheduled" caution doesn't apply to them) and to place a SEPARATE block per child for `individual` activities. `schedule_block` gains an optional `forChildId`: when the activity targets that child (or everyone), the block is scoped to `targetChildren:[forChildId]` + records `forChildId`, creating a per-child session.
- **`web/src/views/ActivityPlayerView.vue`** — `targetChildren` now prefers the BLOCK's `targetChildren` over the activity's (was the reverse), so a per-child scheduled block shows just that child and renders their `contentByChild` variant. Closes the differentiation loop: plan marks individual → scheduler makes per-child blocks → player shows the per-child content + per-child link. Stale/garbage ids still fall back to all children.
- **Tests:** scheduler.test.js (+2: `weeklyRepeatTarget`, `describeMaterialForPool`). **178 functions-unit + 31 web vitest green, web build clean.**
- **Deployed 2026-06-26:** function autoSchedule + hosting. CAVEAT: per-child/repetition behavior is agent-driven off the pool hints, and only kicks in for activities whose plan carries material meta (re-run content planning first). Repetition counts are guidance (`aim ~N×`), not hard-enforced.

### E2-H: Creative-tier material meta on the content plan — DONE & DEPLOYED 2026-06-26

The content-planning agent now decides each activity's **material meta** — the missing input the scheduler (repetition counts) and differentiation (individual-vs-shared) always needed.
- **`functions/agents/contentPlan.js`** — `record_subject_plan` schema gains per-activity `repeatable` / `repeatFrequency` / `complexity` / `targetingMode`; `sanitizeSubjectPlan` normalizes them into a `material` block (case-insensitive, `repeatFrequency`∈{daily,weekly,biweekly,monthly,once}, `complexity` 1-5 falling back to the activity rank, `targetingMode`∈{individual,shared} else "" so a hallucination doesn't override the audit heuristic; a repeatable item with no frequency defaults to daily). The `material` block is stamped onto `activities/{id}.plan.material` and surfaced in the content-worker canvas (`buildPlanContextString`) as a repeatable/individually-paced hint. Prompt instructs the agent to set it.
- **`functions/platform/activityAudit.js`** — `classifyActivity` now treats `plan.material.targetingMode` as **authoritative** for the individual-vs-shared axis when set (coopMode is set inconsistently by the syllabus agent, so the type+coop heuristic is only the fallback). Report adds `pacedSource` ("plan"|"heuristic") + `targetingMode`; the split rationale notes when the plan drove it. This lets the differentiation audit trust a deliberate decision instead of guessing — e.g. a `teaching` activity the heuristic keeps shared is correctly clubbed→split when the plan marks it individual.
- **Tests:** contentPlan.test.js (+4 material-meta cases) + activityAudit.test.js (+3 targetingMode-override cases). **176 functions-unit green.**
- **Deployed 2026-06-26:** functions requestContentPlanning, auditActivityDifferentiation. No web changes (audit UI renders the improved rationale/recommendation automatically). CAVEAT: material meta populates only on the NEXT content-planning run (existing plans lack it → audit falls back to the heuristic until re-planned). Scheduler does not yet READ `repeatable`/`repeatFrequency` for repetition counts — that's the next consumer.

### E2-G: Qaida library wiring (first `materialRef`) — DONE & DEPLOYED 2026-06-26

The first activity↔material link: `qaida_exercise` drill items now reference the shared `nooraniQaida` library and consume its curated spell-out recording + canonical script instead of TTS-ing the raw glyph.
- **`functions/agents/qaidaLibrary.js`** (new) — `normalizeGlyph` (NFC + trim, harakat-sensitive), `buildGlyphMap` (normalized-glyph → library item, earliest lesson wins duplicates), `linkQaidaItem` (attaches `materialRef={collection,lessonId,glyph}` + denormalizes `spellScript`/`audioUrl`, backfills blank translit), `enrichQaidaContent(content,{db|glyphMap})` (5-min TTL module cache, best-effort, never throws). Content still **embeds** the audio/script (offline + token player keep working); `materialRef` records the linkage for the future full split.
- **`functions/agents/activityContent.js`** — `enrichQaidaContent` runs after capture (mirrors the `quran_reading` enrichment block), before the image step. Composes across all 3 generation paths (inline syllabus `create_activity`, on-demand regenerate/backfill, per-child `differentiateActivities`) — all route through `generateContentForActivity` and pass `db`.
- **`web/src/components/ActivityContent.vue`** — `reciteGlyph(it,lang)`: `playAudio(it.audioUrl)` (curated recording) with TTS `onError` fallback; renders `it.spellScript` caption; linked glyphs get `.glyph-lib` accent + 🎧 icon (vs 🔊 for TTS-only).
- **Tests:** `functions/test/qaidaLibrary.test.js` (9) + `web/src/components/ActivityContent.qaida.test.js` (5). **169 functions-unit + 31 web vitest green, web build clean.**
- **Deployed 2026-06-26:** functions generateActivityContent, backfillActivityContent, requestContentBackfill, contentBackfillWorker, requestContentSample, regenerateFailedContent, generateSyllabus, syllabusWorker, differentiateActivities + hosting (also ships the E2-D `contentByChild` child-link web changes). Users hard-refresh once (SPA-cache).
- **CAVEAT:** linking happens at generation time → only NEW/regenerated qaida content is linked (existing activities need Regenerate/backfill). A glyph plays a recording only once the superadmin has run the Qaida audio job for that glyph (else it matches script-only and still TTS-falls-back). Matching is exact-normalized & harakat-sensitive — a drill glyph not in the standard corpus stays TTS.

### Open / deferred after E2-F

| Item | Status |
|---|---|
| ChildPlayerView + token embed render `contentByChild` (not shared `content`) | ✅ DONE 2026-06-25 — per-child child links + "For \<name\>" badge |
| Wire `qaida_exercise` activity renderer to pull from `nooraniQaida` library (materialRef) | ✅ DONE 2026-06-26 — glyph→library link, curated spell-out audio + script in player |
| Creative-tier material meta (`repeatable`, `repeatFrequency`, `complexity`, `targetingMode`) on `contentPlan.js` | ✅ DONE & DEPLOYED 2026-06-26 — plan emits material meta; audit consumes `targetingMode` authoritatively |
| Superadmin runs import → generate audio → audits voice quality | ⬜ Operational — audio worker now SELF-PACES (~48/day) under the free TTS limit and auto-resumes across days (E2-K), so ~449 clips fully voice in ~9-10 days with no restart; no billing upgrade required |
| Activity Qaida renderer in ChildPlayerView uses shared audio clips from `nooraniQaida` | ✅ DONE 2026-06-26 — same `ActivityContent` renderer + token embed carry the denormalized library audio |

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
