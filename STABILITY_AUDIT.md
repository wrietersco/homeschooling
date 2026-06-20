# Dar-al-Hikmah OS — Stability, Robustness & Bug Audit

**Date:** 2026-06-19
**Branch:** `epic2-quran-taxonomy-grounding`
**Scope:** Cloud Functions backend (`functions/`), Firestore/Storage rules, and the Vue SPA (`web/src/`). `legacy/` and `node_modules/` excluded.

This audit catalogs correctness bugs, performance/cost hazards, security gaps, and robustness weaknesses, each with a concrete proposed fix. Findings are ordered by severity. Line references are to the files as they stand on this branch.

---

## Severity summary

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | 🔴 Critical | Security / Cost | Public `testImageGen` HTTP endpoint guarded only by a static query string |
| 2 | 🔴 Critical | Performance / Cost | `enrichQuranContent` re-downloads the **entire Qur'an** per missing verse |
| 3 | 🟠 High | Correctness | `runSyllabus` direct path can infinite-loop on a perpetually-failing subject |
| 4 | 🟠 High | Performance | `importQuran` refetches the whole Qur'an bundle on every batch call |
| 5 | 🟠 High | Security / Tenancy | Disabled family status is never enforced |
| 6 | 🟠 High | Data hygiene / Security | Player tokens accumulate forever; expiry enforced only client-side |
| 7 | 🟡 Medium | Config | Storage bucket mismatch between Admin SDK and web client |
| 8 | 🟡 Medium | Correctness | `FieldValue.serverTimestamp()` used against documented prototype-clash gotcha |
| 9 | 🟡 Medium | Robustness | No retry/backoff on Gemini calls; one transient 5xx fails a whole run |
| 10 | 🟡 Medium | Correctness | Word-by-word Qur'an audio index can desync from the WBW CDN |
| 11 | 🟡 Medium | Correctness | `resolveTargetChildren` substring matching yields false positives |
| 12 | 🟡 Medium | Cost / Abuse | No throttling or guardrails on expensive callables |
| 13 | 🟡 Medium | Observability | Safety/`promptFeedback` blocks are swallowed as empty responses |
| 14 | 🟢 Low | Hygiene | Stale placeholder `agent` function & rewrite still deployed |
| 15 | 🟢 Low | Robustness | Index count drift with no reconciliation |
| 16 | 🟢 Low | Config | Web build silently falls back to `demo-api-key` |
| 17 | 🟢 Low | Robustness | Inline base64 audio/data-URL fallbacks can bloat responses |
| 18 | 🟢 Low | Observability | Pervasive silent `catch {}` blocks hinder diagnosis |

---

## 🔴 Critical

### 1. Public `testImageGen` endpoint burns the paid API key

**Where:** [functions/index.js:86-100](functions/index.js)

```js
export const testImageGen = onRequest({ cors: true, secrets: ["GEMINI_API_KEY"] }, async (req, res) => {
  if (req.query.k !== "verify-7a2f") { res.status(403).send("forbidden"); return; }
  ...generateActivityImage({ ... apiKey: process.env.GEMINI_API_KEY ... })
```

This is an unauthenticated, CORS-enabled HTTP function whose only protection is a hardcoded query parameter (`?k=verify-7a2f`) committed to the repo. Anyone who reads the source (or the deployed URL in logs) can invoke paid Gemini image generation at will — a direct cost-drain and abuse vector. The comment already flags it as `TEMPORARY ... Remove after.`

**Impact:** Unbounded billing exposure; the secret-bearing function is callable by the public.

**Fix:**
- Delete `testImageGen` entirely (it has served its verification purpose), and remove any lingering references.
- If a smoke test is still wanted, gate it behind `onCall` + `requireSuperAdmin` (auth token check) instead of a static string, and never CORS-open it.

---

### 2. `enrichQuranContent` downloads the entire Qur'an per uncovered verse

**Where:** [functions/agents/quranSource.js:166-254](functions/agents/quranSource.js)

The fallback chain is:

```
fetchVerse({surah, ayah})  →  fetchChapterVerses({surah})  →  fetchPublicQuranBundle()
```

`fetchPublicQuranBundle` fetches **three full editions of all 114 surahs** (`quran-uthmani`, `en.sahih`, `en.transliteration`) and rebuilds every verse — and it is called **once per missing verse** inside the `for (const verse of verses)` loop at [quranSource.js:232-250](functions/agents/quranSource.js). A 7-ayah `quran_reading` activity with an empty local `quran/*` collection triggers ~7 complete-Qur'an downloads.

Because the project was wiped and rebuilt (per project memory) and the full-Qur'an import is a manual superadmin step, the local cache is frequently empty — so this is the *default* path, not an edge case. It runs inline during `create_activity` in the syllabus worker, multiplying the cost across every Qur'an activity in a build.

**Impact:** Multi-second-to-timeout latency, large egress, third-party rate-limiting, and content generation that silently degrades to `ai_unverified`. Can blow the 540s function timeout on a large syllabus.

**Fix:**
- Memoize the bundle within a single function invocation (module-level cache keyed by edition), or better, fetch per-surah on demand and cache per surah:
  ```js
  const _surahCache = new Map();
  async function getSurahBundle(surah, fetchImpl) {
    if (_surahCache.has(surah)) return _surahCache.get(surah);
    // fetch ONLY this surah's 3 editions via /surah/{n}/{edition}
  }
  ```
  AlQuran.Cloud supports per-surah endpoints (`/surah/{number}/{edition}`) — use those instead of `/quran/{edition}`.
- Group `enrichQuranContent`'s uncovered verses by surah and fetch each surah at most once.
- Strongly recommend running the one-time `importQuran` on deploy so the local-first path covers everything and the network path is never hit.

---

## 🟠 High

### 3. `runSyllabus` can infinite-loop on a failing subject

**Where:** [functions/agents/syllabus.js:530-542](functions/agents/syllabus.js)

```js
do {
  result = await continueSyllabusRun({ ... subjectLimit: 1 });
} while (!result.done);
```

`done` is computed as `completedSubjects >= totalSubjects` ([syllabus.js:491](functions/agents/syllabus.js)). When a subject throws, it is marked `status:"error"` (not `"done"`), and on the next pass `continueSyllabusRun` re-selects it because the skip guard only checks `status === "done" || activityCount >= target` ([syllabus.js:424](functions/agents/syllabus.js)). A subject that errors every time (e.g. a persistent LLM/network failure) is retried forever and `done` never becomes true.

The production scheduled worker (`syllabusWorker`) is safe — on error it stops re-queueing — but `runSyllabus` is the synchronous path used by integration tests and any direct caller, where it will hang until the 540s timeout.

**Impact:** Hung invocations, wasted compute, timeouts.

**Fix:** Treat `error` as terminal for loop-completion, and cap retries:
```js
const done = values.every(s => s.status === "done" || s.status === "error");
```
and/or add a per-subject `attempts` counter that flips the subject to a terminal `"failed"` state after N tries. Apply the same `every(done|error)` completion check in `continueSyllabusRun` ([syllabus.js:491](functions/agents/syllabus.js)).

---

### 4. `importQuran` refetches the whole bundle every batch

**Where:** [functions/platform/quranImport.js:51](functions/platform/quranImport.js)

```js
const chapters = await fetchPublicQuranBundle({}); // ALL 114 surahs × 3 editions
const todo = ... .slice(0, limit);                 // ...to write 8
```

Each batched import call downloads the complete Qur'an just to persist `limit` (≤20) surahs. A full import of 114 surahs at 8/batch = ~15 calls, each re-downloading everything (~15× redundant transfer).

**Impact:** Slow imports, unnecessary egress, more exposure to upstream rate-limits.

**Fix:** Share the same per-surah fetch helper introduced in fix #2 and fetch only the surahs in `todo`. Or fetch the bundle once into a module/closure cache reused across the batch loop within a single invocation.

---

### 5. Disabled family status is never enforced

**Where:** [functions/lib/caller.js:8-22](functions/lib/caller.js) vs. [functions/platform/admin.js:38-47](functions/platform/admin.js)

`setFamilyStatus` can set a family to `status:"disabled"`, but `resolveCaller` — the gate for every family-scoped callable — never reads or checks `families/{id}.status`. A disabled family's members retain full access to `askGuide`, `generateSyllabus`, `autoSchedule`, content backfill, deletes, etc.

**Impact:** "Disabling" a family is cosmetic; it does not stop usage or spend.

**Fix:** In `resolveCaller`, load the family doc and reject when disabled:
```js
const famSnap = await db.collection("families").doc(familyId).get();
if (famSnap.data()?.status === "disabled")
  throw new HttpsError("permission-denied", "This family is disabled.");
```
(Superadmin-targeted lifecycle calls already bypass `resolveCaller`, so they remain unaffected.)

---

### 6. Player tokens accumulate forever; expiry is client-side only

**Where:** [web/src/services/player.js:9-31](web/src/services/player.js), [web/src/views/ChildPlayerView.vue:59-63](web/src/views/ChildPlayerView.vue), [firestore.rules:126-127](firestore.rules)

Every play session creates a `playerTokens/{uuid}` doc embedding the full activity `content`, with an 8-hour `expiresAt` — but:
- Nothing ever deletes expired tokens. They pile up indefinitely (one per session, forever).
- `expiresAt` is enforced **only in the browser** (`ChildPlayerView`). The rule is `allow read: if true`, so an expired token is still fully readable by anyone with the `familyId.tokenId` string. The check is trivially bypassed by reading Firestore directly.

The token IDs are unguessable UUIDs, so this is not a broad exposure, but a leaked/forwarded link never actually expires server-side, and the collection grows without bound.

**Impact:** Unbounded storage growth; "expiry" provides no real security guarantee.

**Fix:**
- Add a TTL policy on `playerTokens.expiresAt` (Firestore native TTL) so expired tokens are auto-deleted server-side.
- Optionally store an `expiresAtMs` (number) and enforce it in rules:
  `allow read: if resource.data.expiresAtMs > request.time.toMillis();`
- Consider scoping token reads more tightly (the child device only needs the one document; a broad `read: if true` on the whole collection is broader than necessary).

---

## 🟡 Medium

### 7. Storage bucket mismatch (Admin SDK vs. web client)

**Where:** [functions/index.js:12-15](functions/index.js) uses `${projectId}.firebasestorage.app`; [web/src/lib/firebase.js:18](web/src/lib/firebase.js) defaults `storageBucket` to `${PROJECT_ID}.appspot.com`.

These are two different bucket names. Server-built download URLs embed `bucket.name`, so server-served images/audio work; but any client code that uses the Firebase Storage SDK directly (`getStorage`, uploads, `ref()`) targets a different bucket than where the functions write. Today the client only reads absolute URLs, so it's latent — but it's a trap for the next person who adds a client-side Storage read/write.

**Fix:** Make the two agree. Set `VITE_FIREBASE_STORAGE_BUCKET` to the `.firebasestorage.app` bucket in the build env, and update the default in `firebase.js` to match `index.js`.

---

### 8. `FieldValue.serverTimestamp()` used against the documented gotcha

**Where:** [functions/agents/guide.js:24,33,46,69,73](functions/agents/guide.js) and [functions/agents/agentIndex.js:34](functions/agents/agentIndex.js)

Project memory records a hard-won gotcha: *"use `new Date()` everywhere in agent functions"* because a `ServerTimestampTransform` from the functions-level package is rejected when the test `db` comes from the root-level `firebase-admin`. `guide.js` and `agentIndex.js` still use `FieldValue.serverTimestamp()`. In production (single package) it works, but it's inconsistent with the rest of the codebase and a footgun for integration tests that inject a root-level admin db.

**Fix:** Replace with `new Date()` for consistency, matching syllabus/scheduler/content. If server-authoritative time is genuinely needed in `agentIndex` triggers (it runs purely server-side, so it's safe there), document the exception explicitly; otherwise normalize.

---

### 9. No retry/backoff on Gemini calls

**Where:** [functions/agents/llm.js:56-68](functions/agents/llm.js), [functions/agents/runtime.js:22](functions/agents/runtime.js)

`createGeminiClient.generate` throws on any non-2xx, and `runAgent` has no retry. A single transient 429/500/network blip aborts the whole agent run (a subject build, a content generation, a brief). Given long multi-step loops, the probability of *at least one* transient failure across a full syllabus build is high.

**Impact:** Spurious whole-run failures; subjects flip to `error` (and, per #3, can loop).

**Fix:** Add bounded exponential-backoff retry around the `fetchImpl` call for retryable statuses (429, 500, 502, 503, 504) and network errors — e.g. 3 attempts with jitter. Keep non-retryable 4xx (400/403/404) fast-failing. This is the single highest-leverage robustness improvement.

---

### 10. Word-by-word Qur'an audio index can desync from the WBW CDN

**Where:** [functions/agents/activityContent.js:320-322,355-359](functions/agents/activityContent.js)

`wordAudioUrl(surah, ayah, ++wordIdx)` assigns a sequential 1-based word index from the LLM's tokenization (`v.words`). The quran.com WBW CDN (`{S}_{A}_{W}.mp3`) indexes words by the **canonical mushaf** tokenization. If the LLM splits a verse into a different number/segmentation of words (very common — it's explicitly an LLM draft), the per-word audio URLs point at the wrong (or nonexistent) word segments. After `enrichQuranContent` overwrites `verse.words` with verified words via `mergeWordGlosses`, the audio URLs computed *earlier* in `sanitizeContent` are not recomputed to match the verified split.

**Impact:** Tapping a word can play the wrong word's recitation or 404 (then fall back to TTS, which has no Arabic voice on most devices → silence).

**Fix:** Compute `wordAudioUrl` only **after** verification, off the verified word array length, and align indices to the verified tokenization. When local/verified words aren't available, prefer falling back to whole-ayah audio rather than guessed per-word URLs.

---

### 11. `resolveTargetChildren` substring matching produces false positives

**Where:** [functions/agents/syllabus.js:44](functions/agents/syllabus.js)

```js
for (const [name, id] of byName) { if (name.length > 1 && lc.includes(name)) { out.push(id); break; } }
```

A child whose name is a substring of another token gets falsely matched (e.g. name `"Ali"` matched inside `"for Ali and Khalid"` is fine, but name `"An"`/`"Ed"`/`"Sam"` inside longer words misfires; `"Sara"` would match the phrase `"Sarah"`). The guard `name.length > 1` is too weak for short names.

**Impact:** Activities silently targeted at the wrong child, affecting the planner, player attribution, and per-child personalization.

**Fix:** Match on word boundaries rather than raw `includes`: tokenize `lc` and compare tokens, or require `\b{name}\b`. Raise the minimum length or only fall back to substring when exact/word matches fail.

---

### 12. No throttling or cost guardrails on expensive callables

**Where:** `generateSyllabus`, `backfillActivityContent`, `requestContentBackfill`, `autoSchedule`, `generateActivityContent`, `rebuildKnowledgeBrief`, `synthesizeSpeech`.

Any `owner`/`parent` member can call these repeatedly with no per-family rate limit, concurrency cap, or daily spend budget. `setGlobalOptions({ maxInstances: 10 })` bounds infrastructure but not API spend. A loop of backfill/syllabus requests (intentional or buggy client retry) can run up Gemini costs.

**Impact:** Unbounded spend per family; no circuit breaker.

**Fix:** Introduce a lightweight per-family rate/budget ledger (e.g. `meta/usage` counting agent invocations per day) checked in `resolveCaller` or per callable, returning `resource-exhausted` past a threshold. Consider App Check to block non-app clients.

---

### 13. Safety/`promptFeedback` blocks are swallowed as empty responses

**Where:** [functions/agents/llm.js:35-48](functions/agents/llm.js)

`parseGeminiResponse` reads only `candidates[0]`. When Gemini blocks a prompt (safety) or returns no candidate, `candidate` is undefined, `text` is `""`, `functionCalls` is empty, and `finishReason` is `null` — so `runAgent` returns an empty `"final"` answer with no signal that anything went wrong. `promptFeedback.blockReason` and candidate `finishReason: "SAFETY"` are ignored.

**Impact:** Silent empty content/answers that look like "the model chose to say nothing"; very hard to debug.

**Fix:** Surface `json.promptFeedback?.blockReason` and a missing-candidate condition as a distinct error/`finishReason` so callers can log it and retry or message the user meaningfully.

---

## 🟢 Low / hygiene

### 14. Stale placeholder `agent` function and rewrite

**Where:** [functions/index.js:105-112](functions/index.js), [firebase.json:22](firebase.json)

The Phase-0 `agent` placeholder (`/api/agent`) is still deployed and wired into hosting. Harmless but dead surface area.

**Fix:** Remove the function and the `/api/agent` rewrite once nothing depends on it.

---

### 15. Index count drift with no reconciliation

**Where:** [functions/agents/agentIndex.js:34-41](functions/agents/agentIndex.js)

Counts are maintained via `FieldValue.increment(±1)` in triggers. Trigger retries (at-least-once delivery) or partial failures can double-count or under-count over time, and there is no periodic reconciliation. The counts feed agent orientation prompts only, so impact is low (stale hint, not user-facing data).

**Fix:** Add an occasional reconciliation (a scheduled job or on-demand recount via `.count()` aggregation) to overwrite `_agent_index/{collection}.count` with ground truth.

---

### 16. Web build silently falls back to `demo-api-key`

**Where:** [web/src/lib/firebase.js:14-21](web/src/lib/firebase.js)

If `VITE_FIREBASE_*` env vars are missing at build time, the production bundle silently ships `apiKey: "demo-api-key"` and `appId: "demo-app-id"`, which fail at runtime against the live project with opaque auth errors.

**Fix:** In a production build (`import.meta.env.PROD` and not using emulators), assert the required vars are present and fail the build loudly, rather than defaulting to demo values.

---

### 17. Inline base64 fallbacks can bloat responses

**Where:** [functions/agents/tts.js:144](functions/agents/tts.js)

When Storage is unavailable, `synthesizeSpeech` returns the entire WAV as a `data:audio/wav;base64,...` payload in the callable response. For longer phrases (up to 2000 chars of text → sizable audio) this inflates the response and the client's in-memory cache. Acceptable as a rare fallback, but worth bounding.

**Fix:** Cap the inline-data fallback to short clips; for longer ones, surface a "speech temporarily unavailable" signal instead of a multi-MB JSON response.

---

### 18. Pervasive silent `catch {}` blocks hinder diagnosis

**Where:** numerous — e.g. [grounding.js:83](functions/agents/grounding.js), [activityContent.js:451,477,523](functions/agents/activityContent.js), [knowledgeBrief.js:90,103,118](functions/agents/knowledgeBrief.js), [quranSource.js:205,247](functions/agents/quranSource.js).

The "best-effort, never block" pattern is correct for resilience, but every failure is discarded with no log. When content silently comes back unverified, or the brief silently stays data-only, there's no breadcrumb to explain why in production.

**Fix:** Keep the swallow semantics but add a `console.warn(...)` with context inside each catch, so Cloud Logging captures the cause without changing control flow.

---

## Cross-cutting recommendations

1. **Add Gemini call retry/backoff (finding #9)** — single biggest reliability win; reduces spurious subject/content/brief failures across the board.
2. **Eliminate the full-Qur'an-per-verse fetch (findings #2, #4)** — switch to per-surah fetch + caching, and ensure `importQuran` is run on deploy so the local-first path dominates.
3. **Enforce server-side what is currently client-side** — family `disabled` status (#5) and token expiry (#6) should both be enforced in functions/rules, not just UI.
4. **Remove temporary/abuse-prone surface** — delete `testImageGen` (#1) and the `agent` placeholder (#14).
5. **Introduce observability** — replace silent catches with contextual `console.warn` (#18) and surface safety blocks (#13); without this, the "best-effort" design is undebuggable in production.
6. **Add per-family cost guardrails + App Check (#12)** before opening up to more families.

## Testing gaps observed

- No test asserts that the unauthenticated child player **cannot** write scores/observations (rules currently require `writable(familyId)` — verify the child flow never attempts a write that would 403).
- No test covers the `runSyllabus` failure-loop path (#3) or the Gemini-error/retry behavior (#9).
- No test covers `enrichQuranContent` with an empty local cache (would expose #2's fan-out).
- No load/cost test exists for backfill or syllabus builds.

---

*Generated from a read-through of the backend agents, platform callables, security rules, and the speech/player frontend. Line references reflect this branch; re-verify after edits.*
