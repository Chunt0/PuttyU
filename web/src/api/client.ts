/**
 * client.ts — the typed backend client (ADR 0002 Gate 1).
 *
 * `openapi-fetch` is typed against `schema.d.ts`, which is generated from the backend's
 * OpenAPI schema (`bun run gen:api`). Any drift between a UI call and the real contract
 * surfaces as a TypeScript error — that's the whole point of the seam.
 *
 * Auth is cookie-based and same-origin (SPEC §1.4): in dev the Vite proxy forwards /api
 * to uvicorn; in prod FastAPI serves this app, so credentials flow without bearer tokens.
 *
 * Streaming endpoints are NOT routed through here — see streaming.ts.
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Use the current origin (not a bare "/") so openapi-fetch builds absolute Request URLs.
// Browser + dev (Vite proxies same-origin) + jsdom tests all resolve correctly; a relative
// base throws "Failed to parse URL" under node's Request in tests.
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "same-origin",
  // Late-bind to the current global fetch (don't capture it at module load) so tests can
  // stub fetch after this module is imported. In the browser this is just window.fetch.
  fetch: (...args) => globalThis.fetch(...args),
});

export type { paths } from "./schema";
