import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Strangler dev wiring (SPEC §1.4): the Vite dev server proxies backend paths to the
// running uvicorn process so cookies flow same-origin. Prod serves web/dist from FastAPI.
const BACKEND = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:7000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1", // bind IPv4 so it matches playwright.config.ts baseURL
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/static": { target: BACKEND, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Playwright owns e2e/; keep Vitest to unit/component tests under src/.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
