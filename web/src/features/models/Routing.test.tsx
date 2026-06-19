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

const SPEND = {
  window_days: 7,
  total_cost_usd: 0.4,
  by_feature: [
    { feature: "deep_research", tier: "deep", input_tokens: 800, output_tokens: 400, est_cost_usd: 0.4, local: false, usage_source: "estimated" },
    { feature: "extraction", tier: "light", input_tokens: 1500, output_tokens: 500, est_cost_usd: 0, local: true, usage_source: "estimated" },
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
    ["/api/router/cost", () => jsonResponse(SPEND)],
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

  it("renders the Spend section: a feature row, an estimated ~$ cost, local-free, and a running total", async () => {
    mockRouting();
    renderWithProviders(<Routing />);

    expect(await screen.findByText("Spend")).toBeInTheDocument();
    // honest framing: estimated, a gauge not a bill
    expect(screen.getByText(/a gauge, not a bill/)).toBeInTheDocument();
    // a metered cloud feature shows a tilde-prefixed dollar estimate (the feature row +
    // the total row both read ~$0.40 here, since the single cloud feature IS the total)
    expect(screen.getByText("deep_research")).toBeInTheDocument();
    expect(screen.getAllByText("~$0.40").length).toBe(2);
    // a local feature reads "local, free" — never "$0.00"
    expect(screen.getByText("local, free")).toBeInTheDocument();
    // and the running total row
    expect(screen.getByText("Total")).toBeInTheDocument();
    // window label surfaced in the header
    expect(screen.getByText(/Est\. cost \(last 7d\)/)).toBeInTheDocument();
  });

  it("an all-local week shows the total as 'free', never ~$0.00 (D8)", async () => {
    stubFetch([
      ["/api/router/config", () => jsonResponse(CONFIG)],
      ["/api/router/resolution", () => jsonResponse(RESOLUTION)],
      ["/api/router/log", () => jsonResponse(LOG)],
      ["/api/router/cost", () => jsonResponse({
        window_days: 7, total_cost_usd: 0,
        by_feature: [{ feature: "extraction", tier: "light", input_tokens: 1500,
                       output_tokens: 500, est_cost_usd: 0, local: true,
                       usage_source: "estimated" }],
      })],
      ["/api/model-endpoints", () => jsonResponse(ENDPOINTS)],
      ["/api/models", () => jsonResponse(MODELS)],
    ]);
    renderWithProviders(<Routing />);
    expect(await screen.findByText("Spend")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("free")).toBeInTheDocument();     // the total cell
    expect(screen.queryByText("~$0.00")).not.toBeInTheDocument();
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
