// Auth store — Firebase Auth state + the user's family pointer (users/{uid}).
// Membership/role for access decisions is enforced server-side by Security
// Rules; this store just drives UI and routing.
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const profile = ref(null); // users/{uid} doc: { familyId, role, ... }
  const claims = ref({});
  const initialized = ref(false);
  // True once the family-pointer snapshot for the CURRENT user has arrived at
  // least once (doc present or not). Reset on each auth change so post-sign-in
  // navigation can wait for an accurate hasFamily, not just a logged-in user.
  const profileLoaded = ref(false);

  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let stopProfile = null;

  onAuthStateChanged(auth, async (fbUser) => {
    user.value = fbUser;
    claims.value = fbUser ? (await fbUser.getIdTokenResult()).claims : {};

    if (stopProfile) {
      stopProfile();
      stopProfile = null;
    }

    if (!fbUser) {
      profile.value = null;
      profileLoaded.value = true; // nothing to load when signed out
      finishInit();
      return;
    }

    // A new user is in: the pointer is not yet known for them.
    profileLoaded.value = false;

    // Live-subscribe to the user's pointer doc so onboarding (which creates it
    // server-side) flips hasFamily reactively without a manual refetch.
    let first = true;
    stopProfile = onSnapshot(
      doc(db, "users", fbUser.uid),
      (snap) => {
        profile.value = snap.exists() ? snap.data() : null;
        profileLoaded.value = true;
        if (first) {
          first = false;
          finishInit();
        }
      },
      () => {
        profile.value = null;
        profileLoaded.value = true;
        finishInit();
      }
    );
  });

  function finishInit() {
    if (!initialized.value) {
      initialized.value = true;
      resolveReady();
    }
  }

  function ready() {
    return readyPromise;
  }

  const isSuperAdmin = computed(() => claims.value.platformRole === "superadmin");
  const familyId = computed(() => profile.value?.familyId || null);
  const role = computed(() => profile.value?.role || null);
  const hasFamily = computed(() => !!familyId.value);

  async function register(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
    return cred.user;
  }
  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  }
  async function loginWithGoogle() {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    return cred.user;
  }
  async function logout() {
    await signOut(auth);
  }
  // Pull fresh custom claims after a server-side claim change (e.g. onboarding).
  async function refreshClaims() {
    if (!user.value) return;
    claims.value = (await user.value.getIdTokenResult(true)).claims;
  }

  return {
    user, profile, claims, initialized, profileLoaded,
    isSuperAdmin, familyId, role, hasFamily,
    ready, register, login, loginWithGoogle, logout, refreshClaims,
  };
});
