import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // Software WebGL contexts share the runner's CPU; concurrent files starve
  // map startup/fallback timers and make GPU screenshot checks unreliable.
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    serviceWorkers: "block",
  },
  reporter: "list",
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command:
          process.env.SIDEQUEST_E2E_PRODUCTION === "1"
            ? "npm run start"
            : "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
