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
  // Must match the Admin SDK's default bucket (functions/index.js initializeApp):
  // Firebase's modern default bucket is <project>.firebasestorage.app. Using the
  // legacy .appspot.com name here pointed the client at a different bucket than
  // where functions write images/audio (audit #7).
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "0",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app-id",
};

// In a real production build (not the emulator), shipping the demo placeholders
// means auth/Firestore will fail with opaque errors. Fail loudly instead (audit #16).
const _isProdBuild = import.meta.env.PROD && import.meta.env.VITE_USE_EMULATORS !== "true";
if (_isProdBuild && (firebaseConfig.apiKey === "demo-api-key" || firebaseConfig.appId === "demo-app-id")) {
  // eslint-disable-next-line no-console
  console.error(
    "[firebase] PRODUCTION build is missing VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID. " +
    "The app will not connect to the live project. Set the VITE_FIREBASE_* env vars before building."
  );
}

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
