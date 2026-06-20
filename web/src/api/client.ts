import createClient from "openapi-fetch";

import type { paths } from "./schema";

// The typed seam (Gate 1): every backend route is reachable through this client
// with types generated from the committed OpenAPI schema. Same-origin in prod;
// the Vite dev proxy forwards /api to the backend in dev.
//
// `fetch` delegates to the live global at call time (instead of openapi-fetch
// binding it once at creation) so tests can swap the global fetch.
export const api = createClient<paths>({
  baseUrl: "/",
  fetch: (request) => fetch(request),
});
