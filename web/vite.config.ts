import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: proxy /api to the FastAPI backend. Prod: FastAPI serves the built SPA
// same-origin (M0-PLAN §1), so the proxy is dev-only. E2e boots the backend on
// its own port and points the proxy there via PUTTYU_API_TARGET.
const apiTarget = process.env.PUTTYU_API_TARGET ?? "http://127.0.0.1:7000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
