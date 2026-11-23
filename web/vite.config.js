import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { wikidoBridgeLauncher } from "./vite/wikido-bridge-launcher.mjs";
import { firebaseEnvGuard } from "./vite/firebase-env-guard.mjs";

// Vite config for the Dar-al-Hikmah Vue 3 SPA.
// Build output (web/dist) is served by Firebase Hosting.
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    // production builds fail if the Firebase web config is missing/placeholder
    mode === "production" ? firebaseEnvGuard({ ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env }) : null,
    // dev-only: lets the studio's "Start the bridge" button spawn
    // `npm run wikido:bridge` and report the real process state
    wikidoBridgeLauncher(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,mjs}", "vite/**/*.{test,spec}.{js,mjs}"],
  },
}));
