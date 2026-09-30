import { defineConfig } from "@playwright/test";

// UI tests (PLAN.md section 10.8) against a harness server on scripted models.
export default defineConfig({
  testDir: "apps/web/e2e",
  timeout: 30_000,
  // One shared harness server (one phone, one memory): tests must not run at the same time.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:8790",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  webServer: {
    command: "npm run -s build -w @harness/web && node apps/web/e2e/testServer.ts",
    url: "http://127.0.0.1:8790",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
