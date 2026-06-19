/** Model-router server-state hooks (Phase-2 T2b — SPEC F7). router_routes.py is born
 * typed, so these ride the real OpenAPI seam — unlike the hand-typed provider seam. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import type { components } from "../../api/schema";
import type { RouterConfig, RouterCost, RouterLogEntry, RouterResolutionRow } from "../../api/types.ts";

export const routerConfigKey = ["router-config"] as const;
export const routerResolutionKey = ["router-resolution"] as const;
export const routerLogKey = ["router-log"] as const;
export const routerCostKey = ["router-cost"] as const;

export const TIERS = ["micro", "light", "standard", "deep"] as const;

export function useRouterConfig() {
  return useQuery({
    queryKey: routerConfigKey,
    queryFn: async (): Promise<RouterConfig> => {
      const { data, error } = await api.GET("/api/router/config");
      if (error || !data) throw new Error("failed to load routing config");
      return data;
    },
  });
}

export function useRouterResolution() {
  return useQuery({
    queryKey: routerResolutionKey,
    queryFn: async (): Promise<RouterResolutionRow[]> => {
      const { data, error } = await api.GET("/api/router/resolution");
      if (error || !data) throw new Error("failed to load routing resolution");
      return data.rows ?? [];
    },
  });
}

export function useRouterLog(limit = 20) {
  return useQuery({
    queryKey: [...routerLogKey, limit] as const,
    queryFn: async (): Promise<RouterLogEntry[]> => {
      const { data, error } = await api.GET("/api/router/log", {
        params: { query: { limit } },
      });
      if (error || !data) throw new Error("failed to load routing log");
      return data.entries ?? [];
    },
  });
}

/** Router spend (SPEC F7 "Spend is visible"): tokens + estimated cost per feature over
 * the default window. A gauge, not a bill — see CONTRACT D8. Rides the real OpenAPI seam. */
export function useRouterCost() {
  return useQuery({
    queryKey: routerCostKey,
    queryFn: async (): Promise<RouterCost> => {
      const { data, error } = await api.GET("/api/router/cost");
      if (error || !data) throw new Error("failed to load routing spend");
      return data;
    },
  });
}

export type RouterConfigUpdate = components["schemas"]["RouterConfigUpdateRequest"];

/** PUT /api/router/config — omitted fields keep their current value; pins/capabilities
 * replace wholly when present, so callers send the full edited map. */
export function useUpdateRouterConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RouterConfigUpdate): Promise<RouterConfig> => {
      const { data, error } = await api.PUT("/api/router/config", { body });
      if (error || !data) throw new Error("failed to update routing config");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: routerConfigKey });
      void qc.invalidateQueries({ queryKey: routerResolutionKey });
    },
  });
}
