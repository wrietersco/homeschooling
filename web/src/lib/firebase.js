// Firebase client initialization.
// In dev we connect to the local emulator suite; in prod we use the live
// project config injected at build time via VITE_FIREBASE_* env vars.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || "homeschooling-b3e57";

// For emulator-only development a demo-style config is sufficient; real keys
// are supplied via .env for production builds (see .env.example).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "0",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app-id",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Connect to emulators when running the dev server or when explicitly enabled.
const useEmulators =
  import.meta.env.VITE_USE_EMULATORS === "true" ||
  (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS !== "false");

if (useEmulators) {
  const host = import.meta.env.VITE_EMULATOR_HOST || "localhost";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
  // eslint-disable-next-line no-console
  console.info(`[firebase] connected to emulators on ${host}`);
}
