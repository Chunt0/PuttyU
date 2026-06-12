/** Provider/model server-state hooks (hand-typed; see ./types.ts for why). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, del, putJson, patchJson, postForm } from "../../api/forms.ts";
import type { DefaultChat, ModelChoice, ModelEndpoint, ModelsResponse } from "./types.ts";

export const endpointsKey = ["model-endpoints"] as const;
export const modelsKey = ["models"] as const;
export const defaultChatKey = ["default-chat"] as const;

export function useModelEndpoints() {
  return useQuery({
    queryKey: endpointsKey,
    queryFn: () => getJson<ModelEndpoint[]>("/api/model-endpoints"),
  });
}

export function useModels() {
  return useQuery({
    queryKey: modelsKey,
    queryFn: () => getJson<ModelsResponse>("/api/models"),
  });
}

export function useDefaultChat() {
  return useQuery({
    queryKey: defaultChatKey,
    queryFn: () => getJson<DefaultChat>("/api/default-chat"),
  });
}

/** Flatten GET /api/models into pickable (endpoint, model) choices for the default picker. */
export function modelChoices(models: ModelsResponse | undefined): ModelChoice[] {
  if (!models) return [];
  return models.items.flatMap((host) =>
    host.models.map((model) => ({
      endpoint_id: host.endpoint_id,
      endpoint_name: host.endpoint_name,
      model,
    })),
  );
}

export interface CreateEndpointInput {
  name?: string;
  base_url: string;
  api_key?: string;
}

export function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEndpointInput) =>
      postForm<ModelEndpoint>("/api/model-endpoints", {
        name: input.name,
        base_url: input.base_url,
        api_key: input.api_key,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: endpointsKey });
      void qc.invalidateQueries({ queryKey: modelsKey });
    },
  });
}

export function useSetEndpointEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      patchJson<ModelEndpoint>(`/api/model-endpoints/${id}`, { is_enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: endpointsKey });
      void qc.invalidateQueries({ queryKey: modelsKey });
    },
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<unknown>(`/api/model-endpoints/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: endpointsKey });
      void qc.invalidateQueries({ queryKey: modelsKey });
      void qc.invalidateQueries({ queryKey: defaultChatKey });
    },
  });
}

/** Set the user's default endpoint + model (two prefs writes; backend has no combined route). */
export function useSetDefaultChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (choice: ModelChoice) => {
      await putJson("/api/prefs/default_endpoint_id", { value: choice.endpoint_id });
      await putJson("/api/prefs/default_model", { value: choice.model });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: defaultChatKey }),
  });
}
