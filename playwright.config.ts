import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @health-design/web dev --host 127.0.0.1 --port 4173 --strictPort",
    env: {
      VITE_APP_ENV: "local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:4173",
  },
});
