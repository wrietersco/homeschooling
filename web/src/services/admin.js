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

// Model tooling (superadmin).
export const getModelCatalog = () => call("getModelCatalog")({});
export const previewModel = (data) => call("previewModel")(data);
export const testAllModels = () => call("testAllModels")({});
