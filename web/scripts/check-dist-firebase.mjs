// Post-build check: the built bundle must contain the real Firebase API key
// (from the env / .env.production).
// Prints only PASS/FAIL, never the key. Skipped for emulator builds.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";

const env = { ...loadEnv("production", process.cwd(), "VITE_"), ...process.env };
if (String(env.VITE_USE_EMULATORS).toLowerCase() === "true") { console.log("check-dist-firebase: emulator build, skipped"); process.exit(0); }
const key = String(env.VITE_FIREBASE_API_KEY || "");
const dir = join(process.cwd(), "dist", "assets");
let all = "";
for (const f of readdirSync(dir)) if (f.endsWith(".js")) all += readFileSync(join(dir, f), "utf8");
if (!key.startsWith("AIza")) { console.error("check-dist-firebase: FAIL – no real VITE_FIREBASE_API_KEY in env"); process.exit(1); }
if (!all.includes(key)) { console.error("check-dist-firebase: FAIL – dist does not contain the configured API key"); process.exit(1); }
console.log("check-dist-firebase: PASS (real API key present in dist)");
