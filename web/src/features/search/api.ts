/**
 * Global search server-state hook (Phase-2 T5 vertical-5 — SPEC F11, CONTRACT D8).
 *
 * global_search_routes.py was born typed, so this rides the real OpenAPI seam
 * (`{ data, error } = await api.GET(...)`; throw on either). The route is read-only and
 * degrades per bucket — it never 500s — so a non-empty error here is a transport failure,
 * not a partial result. Gated on `q.trim().length >= 2` so a single keystroke doesn't fire.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { GlobalSearchResponse } from "../../api/types.ts";

/** Query key for one global-search term. The debounced (deferred) value is the cache key. */
export const searchKey = (q: string) => ["global-search", q] as const;

/**
 * Search across courses, notes, todos, sessions, materials, and concepts for `q`.
 * Disabled until `q` has two non-blank characters (the palette shows a hint below that).
 */
export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: searchKey(q),
    enabled: q.trim().length >= 2,
    queryFn: async (): Promise<GlobalSearchResponse> => {
      const { data, error } = await api.GET("/api/cmdk", {
        params: { query: { q } },
      });
      if (error || !data) throw new Error("search failed");
      return data;
    },
  });
}
