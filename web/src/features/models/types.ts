/**
 * Hand-written types for the provider/model endpoints in routes/model_routes.py.
 *
 * These are NOT generated from OpenAPI: model_routes.py is a 2091-line frozen god-file
 * (see .fitness/oversized-allowlist.txt) whose endpoints lack response_models, so wiring
 * the typed seam there waits for a dedicated split (SPEC P-T6). Until then these mirror
 * the backend shapes (mapped from the route returns); a backend change can drift silently,
 * which is the tradeoff for not editing the frozen file now.
 */

/** One item of GET /api/model-endpoints (a configured provider). */
export interface ModelEndpoint {
  id: string;
  name: string;
  base_url: string;
  has_key: boolean;
  is_enabled: boolean;
  models: string[];
  pinned_models: string[];
  hidden_count: number;
  online: boolean;
  status: "online" | "empty" | "offline" | string;
  ping_error: string | null;
  model_type: string;
  supports_tools: boolean | null;
  endpoint_kind: string;
  category: string;
}

/** One host group from GET /api/models -> items[]. */
export interface ModelHostItem {
  endpoint_id: string;
  endpoint_name: string;
  url: string;
  models: string[];
  models_display: string[];
  category: string;
  endpoint_kind: string;
  model_type: string;
  offline?: boolean;
}

export interface ModelsResponse {
  hosts: unknown[];
  items: ModelHostItem[];
}

/** GET /api/default-chat — the user's current default endpoint + model. */
export interface DefaultChat {
  endpoint_id: string;
  endpoint_url: string;
  model: string;
}

/** A flattened (endpoint, model) choice for the default-model picker. */
export interface ModelChoice {
  endpoint_id: string;
  endpoint_name: string;
  model: string;
}
