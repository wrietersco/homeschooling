// Phase 8 — Super Admin callables.
// All functions require platformRole === 'superadmin' in the caller's token.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { platformLlmConfig, userRef, familyPaths } from "../lib/paths.js";
import { AGENT_KEYS, AGENT_DEFAULTS, readLlmConfigDoc, mergeAgentConfig } from "../agents/agentConfig.js";

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
  return request.auth.uid;
}

// ── List all families ────────────────────────────────────────────────────────
// Returns [{id, name, status, memberCount, createdAt}] for every family doc.
export const listFamilies = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const snap = await db.collection("families").get();
  const results = await Promise.all(
    snap.docs.map(async (d) => {
      const members = await d.ref.collection("members").count().get();
      return {
        id: d.id,
        name: d.data().name || "(unnamed)",
        status: d.data().status || "active",
        memberCount: members.data().count,
        createdAt: d.data().createdAt?.toMillis?.() ?? null,
      };
    })
  );
  return { families: results };
});

// ── Set family status ────────────────────────────────────────────────────────
export const setFamilyStatus = onCall(async (request) => {
  requireSuperAdmin(request);
  const { familyId, status } = request.data ?? {};
  if (!familyId || !["active", "disabled"].includes(status)) {
    throw new HttpsError("invalid-argument", "familyId and status ('active'|'disabled') required.");
  }
  const db = getFirestore();
  await db.collection("families").doc(familyId).update({ status, updatedAt: new Date() });
  return { ok: true };
});

// ── List members of a family ─────────────────────────────────────────────────
export const listFamilyMembers = onCall(async (request) => {
  requireSuperAdmin(request);
  const { familyId } = request.data ?? {};
  if (!familyId) throw new HttpsError("invalid-argument", "familyId required.");
  const db = getFirestore();
  const snap = await db.collection("families").doc(familyId).collection("members").get();
  return {
    members: snap.docs.map((d) => ({
      uid: d.id,
      role: d.data().role,
      email: d.data().email || null,
      displayName: d.data().displayName || null,
      joinedAt: d.data().joinedAt?.toMillis?.() ?? null,
    })),
  };
});

// ── Change a member's role ───────────────────────────────────────────────────
export const setMemberRole = onCall(async (request) => {
  requireSuperAdmin(request);
  const { familyId, memberUid, role } = request.data ?? {};
  if (!familyId || !memberUid || !["owner", "parent", "viewer"].includes(role)) {
    throw new HttpsError("invalid-argument", "familyId, memberUid, and role required.");
  }
  const db = getFirestore();
  const auth = getAuth();
  await db.collection("families").doc(familyId).collection("members").doc(memberUid).update({ role });
  await userRef(db, memberUid).update({ role });
  const existing = (await auth.getUser(memberUid)).customClaims ?? {};
  await auth.setCustomUserClaims(memberUid, { ...existing, role });
  return { ok: true };
});

// ── Remove a member from a family ───────────────────────────────────────────
export const removeMember = onCall(async (request) => {
  requireSuperAdmin(request);
  const { familyId, memberUid } = request.data ?? {};
  if (!familyId || !memberUid) throw new HttpsError("invalid-argument", "familyId and memberUid required.");
  const db = getFirestore();
  const auth = getAuth();
  const batch = db.batch();
  batch.delete(db.collection("families").doc(familyId).collection("members").doc(memberUid));
  // Clear the family pointer so the user lands on onboarding if they sign in.
  const userSnap = await userRef(db, memberUid).get();
  if (userSnap.exists && userSnap.data()?.familyId === familyId) {
    batch.update(userRef(db, memberUid), { familyId: null, role: null });
  }
  await batch.commit();
  const existing = (await auth.getUser(memberUid)).customClaims ?? {};
  delete existing.familyId;
  delete existing.role;
  await auth.setCustomUserClaims(memberUid, existing);
  return { ok: true };
});

// ── Delete a family and all its data ────────────────────────────────────────
// Uses Admin SDK recursiveDelete which handles all subcollections.
export const deleteFamily = onCall({ timeoutSeconds: 300 }, async (request) => {
  requireSuperAdmin(request);
  const { familyId } = request.data ?? {};
  if (!familyId) throw new HttpsError("invalid-argument", "familyId required.");
  const db = getFirestore();
  // Gather all members so we can clear their user docs.
  const membersSnap = await db.collection("families").doc(familyId).collection("members").get();
  const auth = getAuth();
  await Promise.all(
    membersSnap.docs.map(async (d) => {
      const uid = d.id;
      try {
        const userSnap = await userRef(db, uid).get();
        if (userSnap.exists && userSnap.data()?.familyId === familyId) {
          await userRef(db, uid).update({ familyId: null, role: null });
        }
        const existing = (await auth.getUser(uid)).customClaims ?? {};
        delete existing.familyId;
        delete existing.role;
        await auth.setCustomUserClaims(uid, existing);
      } catch {
        // member user may have been deleted externally — continue
      }
    })
  );
  await db.recursiveDelete(db.collection("families").doc(familyId));
  return { ok: true };
});

// ── Per-agent LLM config ─────────────────────────────────────────────────────
// One document holds a global `default` block + optional per-agent overrides.
// getLlmConfig returns the EFFECTIVE (merged) settings per agent so the editor
// is fully prefilled; setLlmConfig persists whatever the editor submits.
export const getLlmConfig = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const doc = await readLlmConfigDoc(db); // { default, agents } (sparse overrides, legacy-migrated)

  const agents = {};
  for (const k of AGENT_KEYS) agents[k] = mergeAgentConfig(doc, k);

  return {
    agentKeys: AGENT_KEYS,
    // Effective global default (built-in baseline ⊕ stored default).
    default: { ...AGENT_DEFAULTS.guide, ...doc.default },
    agents,
  };
});

// Validate + clamp one agent's settings block. Only known fields are persisted.
function sanitizeBlock(raw = {}) {
  const out = {};
  if (raw.model != null) out.model = String(raw.model).slice(0, 100) || "gemini-2.5-flash";
  if (raw.temperature != null) out.temperature = Math.max(0, Math.min(2, Number(raw.temperature) || 0));
  if (raw.maxOutputTokens != null) out.maxOutputTokens = Math.max(256, Math.min(65536, Number(raw.maxOutputTokens) || 2048));
  if (raw.thinkingBudget != null) out.thinkingBudget = Math.max(0, Math.min(24576, Number(raw.thinkingBudget) || 0));
  if (raw.systemInstructions != null) out.systemInstructions = String(raw.systemInstructions).slice(0, 8000);
  if (raw.voiceName != null) out.voiceName = String(raw.voiceName).slice(0, 60);
  return out;
}

export const setLlmConfig = onCall(async (request) => {
  requireSuperAdmin(request);
  const data = request.data ?? {};
  const config = {
    default: sanitizeBlock(data.default),
    agents: {},
    updatedAt: new Date(),
  };
  for (const k of AGENT_KEYS) {
    if (data.agents && data.agents[k]) config.agents[k] = sanitizeBlock(data.agents[k]);
  }
  const db = getFirestore();
  // Overwrite (not merge) so removed overrides actually clear.
  await platformLlmConfig(db).set(config);
  return { ok: true };
});
