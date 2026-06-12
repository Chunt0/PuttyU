import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Providers } from "./Providers.tsx";
import { renderWithProviders, jsonResponse, stubFetch } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const ENDPOINTS = [
  {
    id: "ep1", name: "Local Ollama", base_url: "http://localhost:11434",
    has_key: false, is_enabled: true, models: ["llama3", "qwen2"], pinned_models: [],
    hidden_count: 0, online: true, status: "online", ping_error: null,
    model_type: "llm", supports_tools: true, endpoint_kind: "local", category: "local",
  },
];
const MODELS = {
  hosts: [],
  items: [
    {
      endpoint_id: "ep1", endpoint_name: "Local Ollama", url: "http://localhost:11434/v1/chat",
      models: ["llama3", "qwen2"], models_display: ["llama3", "qwen2"],
      category: "local", endpoint_kind: "local", model_type: "llm",
    },
  ],
};

function mockProviders(overrides: Partial<Record<string, () => Response>> = {}) {
  return stubFetch([
    ["/api/model-endpoints", overrides["endpoints"] ?? (() => jsonResponse(ENDPOINTS))],
    ["/api/models", overrides["models"] ?? (() => jsonResponse(MODELS))],
    ["/api/default-chat", overrides["default"] ?? (() => jsonResponse({ endpoint_id: "", endpoint_url: "", model: "" }))],
    ["/api/prefs/", () => jsonResponse({ key: "x", value: "y" })],
  ]);
}

describe("Providers", () => {
  it("lists configured endpoints with model counts", async () => {
    mockProviders();
    renderWithProviders(<Providers />);
    expect(await screen.findByText("Local Ollama")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:11434")).toBeInTheDocument();
    expect(screen.getByText("2 models")).toBeInTheDocument();
  });

  it("populates the default-model picker from available models", async () => {
    mockProviders();
    renderWithProviders(<Providers />);
    const select = await screen.findByLabelText("Default chat model");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(1));
    expect(screen.getByRole("option", { name: /llama3/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /qwen2/ })).toBeInTheDocument();
  });

  it("sets the default model via two prefs writes", async () => {
    const fetchMock = mockProviders();
    renderWithProviders(<Providers />);
    const select = await screen.findByLabelText("Default chat model");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(1));

    await userEvent.selectOptions(select, "ep1|llama3");

    await waitFor(() => {
      const prefsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/prefs/"));
      const keys = prefsCalls.map((c) => String(c[0]));
      expect(keys.some((k) => k.includes("default_endpoint_id"))).toBe(true);
      expect(keys.some((k) => k.includes("default_model"))).toBe(true);
    });
  });

  it("adds a new endpoint via the form", async () => {
    const fetchMock = mockProviders();
    renderWithProviders(<Providers />);
    await screen.findByText("Local Ollama");

    await userEvent.type(screen.getByLabelText("Base URL"), "http://localhost:8000");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/api/model-endpoints") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect((post![1] as RequestInit).body).toBeInstanceOf(FormData);
    });
  });
});
