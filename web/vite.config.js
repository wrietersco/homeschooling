import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { wikidoBridgeLauncher } from "./vite/wikido-bridge-launcher.mjs";

// Vite config for the Dar-al-Hikmah Vue 3 SPA.
// Build output (web/dist) is served by Firebase Hosting.
export default defineConfig({
  plugins: [
    vue(),
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
});
