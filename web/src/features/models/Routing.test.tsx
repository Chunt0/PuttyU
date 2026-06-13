import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routing } from "./Routing.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const CONFIG = {
  policy: "local_first",
  configured: true,
  pins: { deep: { endpoint_id: "ep2", model: "claude-sonnet-4-5" } },
  capabilities: { ep1: { vision: false, reasoning: "light" } },
};

const RESOLUTION = {
  policy: "local_first",
  configured: true,
  rows: [
    { tier: "micro", modality: "text", endpoint_id: "ep1", model: "qwen3:4b", token_budget: 2048, why: "policy=local_first: tier 'micro' -> 'ep1' (reasoning=light, local)", degraded: false },
    { tier: "standard", modality: "text", endpoint_id: "ep1", model: "qwen3:4b", token_budget: 8192, why: "policy=local_first [degraded: nearest tier, no standard-class candidate]", degraded: true },
    { tier: "standard", modality: "vision", error: "No vision-capable model is configured." },
  ],
};

const LOG = {
  entries: [
    { ts: 1760000000, endpoint_id: "ep1", model: "qwen3:4b", why: "pinned for tier 'micro'", profile: { tier: "micro" } },
  ],
};

const ENDPOINTS = [
  { id: "ep1", name: "Ollama box", base_url: "http://localhost:11434/v1", has_key: false, is_enabled: true, models: ["qwen3:4b"], pinned_models: [], hidden_count: 0, online: true, status: "online", ping_error: null, model_type: "chat", supports_tools: true, endpoint_kind: "openai", category: "local" },
];

const MODELS = {
  hosts: [],
  items: [
    { endpoint_id: "ep1", endpoint_name: "Ollama box", url: "http://localhost:11434/v1", models: ["qwen3:4b"], models_display: ["qwen3:4b"], category: "local", endpoint_kind: "openai", model_type: "chat" },
    { endpoint_id: "ep2", endpoint_name: "Anthropic", url: "https://api.anthropic.com", models: ["claude-sonnet-4-5"], models_display: ["claude-sonnet-4-5"], category: "cloud", endpoint_kind: "anthropic", model_type: "chat" },
  ],
};

function mockRouting() {
  return stubFetch([
    ["/api/router/config", () => jsonResponse(CONFIG)],
    ["/api/router/resolution", () => jsonResponse(RESOLUTION)],
    ["/api/router/log", () => jsonResponse(LOG)],
    ["/api/model-endpoints", () => jsonResponse(ENDPOINTS)],
    ["/api/models", () => jsonResponse(MODELS)],
  ]);
}

/** Read a recorded openapi-fetch call's JSON body (the mock receives a Request). */
async function requestJson(call: unknown[]): Promise<Record<string, unknown>> {
  return (call[0] as Request).clone().json() as Promise<Record<string, unknown>>;
}

describe("Routing (F7)", () => {
  it("renders the live resolution table, degradation notes and the vision setup hint", async () => {
    mockRouting();
    renderWithProviders(<Routing />);

    expect(await screen.findByText("Live resolution")).toBeInTheDocument();
    expect(screen.getAllByText("qwen3:4b").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/degraded: nearest tier/)).toBeInTheDocument();
    expect(screen.getByText("No vision-capable model is configured.")).toBeInTheDocument();
    // recent decisions render too
    expect(screen.getByText("pinned for tier 'micro'")).toBeInTheDocument();
  });

  it("changes the policy dial via PUT", async () => {
    const fetchMock = mockRouting();
    renderWithProviders(<Routing />);
    await screen.findByText("Live resolution");

    await userEvent.click(screen.getByLabelText(/quality-first/));
    let put: unknown[] | undefined;
    await waitFor(() => {
      put = findCall(fetchMock, "/api/router/config", "PUT");
      expect(put).toBeTruthy();
    });
    expect(await requestJson(put!)).toEqual({ policy: "quality_first" });
  });

  it("pins a tier, sending the full pins map", async () => {
    const fetchMock = mockRouting();
    renderWithProviders(<Routing />);
    await screen.findByText("Live resolution");

    await userEvent.selectOptions(screen.getByLabelText("Pin for standard"), "ep1|qwen3:4b");
    let put: unknown[] | undefined;
    await waitFor(() => {
      put = findCall(fetchMock, "/api/router/config", "PUT");
      expect(put).toBeTruthy();
    });
    expect(await requestJson(put!)).toEqual({
      pins: {
        deep: { endpoint_id: "ep2", model: "claude-sonnet-4-5" },
        standard: { endpoint_id: "ep1", model: "qwen3:4b" },
      },
    });
  });

  it("tags an endpoint vision-capable, sending the full capability map", async () => {
    const fetchMock = mockRouting();
    renderWithProviders(<Routing />);
    await screen.findByText("Live resolution");

    await userEvent.click(screen.getByLabelText("Ollama box vision capable"));
    let put: unknown[] | undefined;
    await waitFor(() => {
      put = findCall(fetchMock, "/api/router/config", "PUT");
      expect(put).toBeTruthy();
    });
    expect(await requestJson(put!)).toEqual({
      capabilities: { ep1: { vision: true, reasoning: "light" } },
    });
  });
});
