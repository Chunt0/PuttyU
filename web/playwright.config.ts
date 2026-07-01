import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// E2e (Gate 3b) runs the REAL stack: FastAPI in test mode + the Vite dev
// server, on dedicated ports so a running dev environment (7000/5173) never
// collides. PUTTYU_TEST_MODE selects the deterministic FakeProvider once the
// model router lands (M0-PLAN §4) — no keys, no tokens, reproducible.
const API_PORT = 7801;
const WEB_PORT = 5273;
const E2E_DATA_DIR = path.join(import.meta.dirname, "test-results", "puttyu-data");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python app.py",
      cwd: "../backend",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PUTTYU_HOST: "127.0.0.1",
        PUTTYU_PORT: String(API_PORT),
        PUTTYU_DATA_DIR: E2E_DATA_DIR,
        PUTTYU_TEST_MODE: "1",
      },
    },
    {
      // --host 127.0.0.1: vite's default `localhost` can resolve to ::1 only,
      // which the readiness poll (and the browser baseURL) would miss.
      command: `bunx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: false,
      env: { PUTTYU_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
