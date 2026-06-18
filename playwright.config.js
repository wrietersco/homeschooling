import { defineConfig, devices } from "@playwright/test";

// E2E config — drives the real Vue app in a browser. The Vite dev server is
// launched automatically (or reused if already running). As the app grows,
// auth/onboarding flows will run against the Firebase emulator suite; Phase 0
// covers static rendering, navigation, and route-guard behavior.
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Dual-view player testing (parent vs child-in-incognito) uses isolated
    // browser contexts within specs; an extra device project isn't required.
  ],
  // Only the Vite dev server is managed here. The Firebase emulator suite is
  // started/torn down around the whole run by `firebase emulators:exec` (see
  // the test:e2e script) — that guarantees clean shutdown, avoiding the orphaned
  // Java process that `emulators:start` leaves behind on Windows when a run
  // fails. The Vite client auto-connects to the emulators in dev mode.
  webServer: {
    command: "npm --prefix web run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
