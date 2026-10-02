import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

const call = (name) => (data) => httpsCallable(functions, name)(data).then((r) => r.data);

export const listFamilies = () => call("listFamilies")({});
export const setFamilyStatus = (familyId, status) => call("setFamilyStatus")({ familyId, status });
export const listFamilyMembers = (familyId) => call("listFamilyMembers")({ familyId });
export const setMemberRole = (familyId, memberUid, role) => call("setMemberRole")({ familyId, memberUid, role });
export const removeMember = (familyId, memberUid) => call("removeMember")({ familyId, memberUid });
export const deleteFamily = (familyId) => call("deleteFamily")({ familyId });
export const getLlmConfig = () => call("getLlmConfig")({});
export const setLlmConfig = (config) => call("setLlmConfig")(config);

// Lifecycle deletes — usable by family admins (own family) and superadmin
// (pass familyId to target a specific family).
export const deleteCurriculum = (curriculumId, familyId) => call("deleteCurriculum")({ curriculumId, familyId });
export const deleteSyllabus = (curriculumId, familyId) => call("deleteSyllabus")({ curriculumId, familyId });

// Full-Quran import (superadmin).
export const getQuranStatus = () => call("getQuranStatus")({});
export const importQuran = (opts) => call("importQuran")(opts || {});

// Noorani Qaida platform library (superadmin). The audit list is read straight
// from the shared nooraniQaida/* collection (signed-in readable); these wrap the
// superadmin-only mutations.
export const getQaidaStatus = () => call("getQaidaStatus")({});
export const importQaida = (opts) => call("importQaida")(opts || {});
// `plan` ({ mode, models:{gemini,openai}, maxWords }) selects the provider(s)/
// model(s) for this bulk run; omitted ⇒ the worker falls back to the TTS config.
export const requestQaidaAudio = (plan) => call("requestQaidaAudio")(plan ? { plan } : {});
export const stopQaidaAudio = () => call("stopQaidaAudio")({});
// preview=true synthesizes a clip to audition without persisting; preview=false
// saves the approved take onto the corpus item. `opts` may carry per-generation
// TTS overrides ({ provider, model, voiceName }) applied to this take only.
export const regenerateQaidaWord = (lessonId, glyph, instruction, preview = false, opts = {}) =>
  call("regenerateQaidaWord")({
    lessonId, glyph, instruction, preview,
    provider: opts.provider || "", model: opts.model || "", voiceName: opts.voiceName || "",
  });
export const deleteQaidaLibrary = () => call("deleteQaidaLibrary")({});
export const deleteQaidaAudio = () => call("deleteQaidaAudio")({});

// Model tooling (superadmin).
export const getModelCatalog = () => call("getModelCatalog")({});
export const previewModel = (data) => call("previewModel")(data);
export const testAllModels = () => call("testAllModels")({});

// Usage dashboard (superadmin) — plain-language usage/limits/health + alerts.
export const getUsageDashboard = () => call("getUsageDashboard")({});

// TTS quota allocation (superadmin).
export const getQuotaConfig = () => call("getQuotaConfig")({});
export const setQuotaConfig = (cfg) => call("setQuotaConfig")(cfg);

// Cost reporting (superadmin).
export const getCostOverview = (month) => call("getCostOverview")(month ? { month } : {});
export const getFamilyCostDetail = (data) => call("getFamilyCostDetail")(data);
export const getSubscriptionAdmin = () => call("getSubscriptionAdmin")({});
export const setPricingPlans = (plans) => call("setPricingPlans")({ plans });
export const setFamilySubscription = (data) => call("setFamilySubscription")(data);
export const getMySubscription = () => call("getMySubscription")({});
export const requestPlanChange = (planId) => call("requestPlanChange")({ planId });
export const reviewPlanRequest = (data) => call("reviewPlanRequest")(data);
export const listPlatformUsers = (pageToken) => call("listPlatformUsers")({ pageToken });
export const createPlatformUser = (data) => call("createPlatformUser")(data);
export const updatePlatformUser = (data) => call("updatePlatformUser")(data);
export const setPlatformUserSuspended = (uid, disabled) => call("setPlatformUserSuspended")({ uid, disabled });
export const setPlatformUserPassword = (uid, password) => call("setPlatformUserPassword")({ uid, password });
export const getPlatformPasswordResetLink = (uid) => call("getPlatformPasswordResetLink")({ uid });

// Activity differentiation audit (owner/parent) — read-only; returns the
// restructure plan for skill-paced activities clubbed across children.
export const auditActivityDifferentiation = () => call("auditActivityDifferentiation")({});

// Differentiation apply (owner/parent) — generates per-child content variants for
// clubbed skill-paced activities. Each call is bounded (usually 1 activity × its
// children) but per-child content + image generation is slow, so override the
// callable's 70s default timeout. The client re-invokes until remaining = 0.
export const differentiateActivities = (data) =>
  httpsCallable(functions, "differentiateActivities", { timeout: 540000 })(data || {}).then((r) => r.data);
