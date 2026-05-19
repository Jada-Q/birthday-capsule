import { defineConfig, devices } from "@playwright/test";

/**
 * Birthday Capsule — E2E smoke test config.
 * Spins up the dev server, runs Chromium against ?dev=1&bypass=1
 * (which skips cam/mic/face-match, leaving the full ritual flow testable).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  timeout: 20_000,

  use: {
    baseURL: "http://localhost:3020",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    port: 3020,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
