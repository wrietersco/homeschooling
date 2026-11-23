// Fails a production build loudly when the Firebase web config is missing or a
// placeholder (a build without web/.env.production signs everyone out with
// auth/api-key-not-valid). Emulator builds (VITE_USE_EMULATORS=true) are exempt.
export const PROJECT_ID = "homeschooling-b3e57";
const KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

// Returns a list of problems (never includes values).
export function firebaseEnvProblems(env) {
  if (String(env.VITE_USE_EMULATORS || "").toLowerCase() === "true") return [];
  const out = [];
  for (const k of KEYS) {
    const v = String(env[k] || "").trim();
    if (!v) out.push(`${k} is missing or empty`);
    else if (/demo|placeholder|your[-_]|changeme|example/i.test(v)) out.push(`${k} looks like a placeholder`);
  }
  const key = String(env.VITE_FIREBASE_API_KEY || "").trim();
  if (key && !key.startsWith("AIza")) out.push("VITE_FIREBASE_API_KEY does not start with AIza");
  const pid = String(env.VITE_FIREBASE_PROJECT_ID || "").trim();
  if (pid && pid !== PROJECT_ID) out.push(`VITE_FIREBASE_PROJECT_ID is not ${PROJECT_ID}`);
  return out;
}

export function firebaseEnvGuard(env) {
  return {
    name: "firebase-env-guard",
    apply: "build",
    buildStart() {
      const problems = firebaseEnvProblems(env);
      if (problems.length) {
        throw new Error(
          "Refusing to build: bad Firebase config.\n  - " + problems.join("\n  - ") +
            "\nCopy web/.env.production into the build folder (it is untracked), or set VITE_USE_EMULATORS=true for an emulator build."
        );
      }
    },
  };
}
