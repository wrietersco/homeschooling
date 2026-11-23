import { describe, it, expect } from "vitest";
import { firebaseEnvProblems } from "./firebase-env-guard.mjs";

const good = {
  VITE_FIREBASE_API_KEY: "AIzaSyAbCdEfGhIjKlMnOp0000000000000000000",
  VITE_FIREBASE_AUTH_DOMAIN: "homeschooling-b3e57.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "homeschooling-b3e57",
  VITE_FIREBASE_STORAGE_BUCKET: "homeschooling-b3e57.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:abcdef",
};
describe("firebaseEnvProblems", () => {
  it("accepts a real config", () => expect(firebaseEnvProblems(good)).toEqual([]));
  it("rejects missing config", () => expect(firebaseEnvProblems({}).length).toBe(6 + 0));
  it("rejects demo key and wrong project", () => {
    const p = firebaseEnvProblems({ ...good, VITE_FIREBASE_API_KEY: "demo-api-key", VITE_FIREBASE_PROJECT_ID: "other" });
    expect(p.join(" ")).toMatch(/AIza/);
    expect(p.join(" ")).toMatch(/not homeschooling-b3e57/);
  });
  it("is exempt for emulator builds", () => expect(firebaseEnvProblems({ VITE_USE_EMULATORS: "true" })).toEqual([]));
  it("never prints values", () => expect(firebaseEnvProblems({ ...good, VITE_FIREBASE_API_KEY: "demo-secret" }).join()).not.toMatch(/demo-secret/));
});
