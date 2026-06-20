import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: proxy /api to the FastAPI backend. Prod: FastAPI serves the built SPA
// same-origin (M0-PLAN §1), so the proxy is dev-only.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:7000", changeOrigin: true },
    },
  },
});
