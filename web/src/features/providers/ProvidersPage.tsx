import { useCallback, useEffect, useState } from "react";

import { api } from "../../api/client";
import type { components } from "../../api/schema";

type EndpointOut = components["schemas"]["EndpointOut"];
type ModelSpec = components["schemas"]["ModelSpec"];
type TierRow = components["schemas"]["TierRow"];
type Provider = "anthropic" | "openai_compat" | "ollama";

const EMPTY_MODEL: ModelSpec = {
  name: "",
  context_window: 32768,
  vision: false,
  reasoning_class: "standard",
  structured: true,
  cost_in: null,
  cost_out: null,
};

// The Providers screen (F7 / M0.2): configure endpoints, watch the live
// resolution table — no silent degradation. Kit-styled at M0.3.
export function ProvidersPage() {
  const [endpoints, setEndpoints] = useState<EndpointOut[]>([]);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [policy, setPolicy] = useState<string>("local_first");
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const [eps, res, settings] = await Promise.all([
      api.GET("/api/model-endpoints"),
      api.GET("/api/router/resolution"),
      api.GET("/api/settings"),
    ]);
    if (eps.data) setEndpoints(eps.data);
    if (res.data) setTiers(res.data.tiers);
    const router = settings.data?.values["router"] as
      | { policy?: string }
      | undefined;
    if (router?.policy) setPolicy(router.policy);
  }, []);

  useEffect(() => {
    reload().catch(() => setError("Cannot reach the backend."));
  }, [reload]);

  const changePolicy = async (next: string) => {
    setPolicy(next);
    await api.PUT("/api/settings", {
      body: { values: { router: { policy: next } } },
    });
    await reload();
  };

  const removeEndpoint = async (id: string) => {
    await api.DELETE("/api/model-endpoints/{endpoint_id}", {
      params: { path: { endpoint_id: id } },
    });
    await reload();
  };

  const testEndpoint = async (id: string) => {
    setProbe((p) => ({ ...p, [id]: "testing…" }));
    const { data } = await api.POST("/api/router/test", {
      body: { endpoint_id: id },
    });
    setProbe((p) => ({
      ...p,
      [id]: data ? `${data.ok ? "✓" : "✗"} ${data.detail}` : "✗ request failed",
    }));
  };

  return (
    <section className="pa-content providers">
      <h1>Providers</h1>
      {error ? <p className="providers-error">{error}</p> : null}

      <div className="providers-policy">
        <label>
          Routing policy
          <select
            value={policy}
            onChange={(e) => void changePolicy(e.target.value)}
          >
            <option value="local_first">local-first (privacy/cost)</option>
            <option value="quality_first">quality-first (best model)</option>
          </select>
        </label>
      </div>

      <h2>Endpoints</h2>
      {endpoints.length === 0 ? (
        <p className="providers-empty">
          No endpoints yet — add one below. Tests run on the built-in
          FakeProvider until then.
        </p>
      ) : (
        <table className="providers-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider</th>
              <th>Models</th>
              <th>Key</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.id}>
                <td>{ep.name}</td>
                <td>{ep.provider}</td>
                <td>{ep.models.map((m) => m.name).join(", ")}</td>
                <td>{ep.has_api_key ? "stored" : (ep.api_key_env ?? "—")}</td>
                <td className="providers-actions">
                  <button onClick={() => void testEndpoint(ep.id)}>Test</button>
                  <button onClick={() => void removeEndpoint(ep.id)}>
                    Remove
                  </button>
                  <span className="providers-probe">{probe[ep.id]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddEndpointForm onAdded={() => void reload()} />

      <h2>Live resolution</h2>
      <table className="providers-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th>Model</th>
            <th>Budget</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tier}>
              <td>{t.tier}</td>
              <td>
                {t.available ? `${t.endpoint_name} / ${t.model}` : "—"}
              </td>
              <td>{t.token_budget ?? "—"}</td>
              <td>
                {!t.available ? (
                  <span className="providers-bad">
                    unavailable ({t.reason})
                  </span>
                ) : t.below_preferred ? (
                  <span className="providers-warn">below preferred</span>
                ) : t.pinned ? (
                  "pinned"
                ) : (
                  "ok"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AddEndpointForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("ollama");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelSpec[]>([{ ...EMPTY_MODEL }]);
  const [error, setError] = useState<string | null>(null);

  const setModel = (i: number, patch: Partial<ModelSpec>) => {
    setModels((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };

  const changeProvider = (p: Provider) => {
    setProvider(p);
    setBaseUrl(
      p === "ollama"
        ? "http://127.0.0.1:11434"
        : p === "anthropic"
          ? "https://api.anthropic.com"
          : "",
    );
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const cleaned = models.filter((m) => m.name.trim() !== "");
    if (cleaned.length === 0) {
      setError("Add at least one model.");
      return;
    }
    const { response } = await api.POST("/api/model-endpoints", {
      body: {
        name,
        provider,
        base_url: baseUrl,
        api_key: apiKey || null,
        api_key_env: null,
        models: cleaned,
        enabled: true,
      },
    });
    if (response.ok) {
      setName("");
      setApiKey("");
      setModels([{ ...EMPTY_MODEL }]);
      onAdded();
    } else {
      setError("Could not add the endpoint — check the fields.");
    }
  };

  return (
    <form className="providers-form" onSubmit={(e) => void submit(e)}>
      <h2>Add endpoint</h2>
      <div className="providers-form-row">
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => changeProvider(e.target.value as Provider)}
          >
            <option value="ollama">Ollama (local)</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai_compat">OpenAI-compatible</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="stored encrypted"
          />
        </label>
      </div>
      {models.map((m, i) => (
        <div className="providers-form-row" key={i}>
          <label>
            Model name
            <input
              value={m.name}
              onChange={(e) => setModel(i, { name: e.target.value })}
            />
          </label>
          <label>
            Context window
            <input
              type="number"
              min={1024}
              value={m.context_window}
              onChange={(e) =>
                setModel(i, { context_window: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Class
            <select
              value={m.reasoning_class}
              onChange={(e) =>
                setModel(i, {
                  reasoning_class: e.target
                    .value as ModelSpec["reasoning_class"],
                })
              }
            >
              <option value="micro">micro</option>
              <option value="light">light</option>
              <option value="standard">standard</option>
              <option value="deep">deep</option>
            </select>
          </label>
          <label className="providers-check">
            <input
              type="checkbox"
              checked={m.vision}
              onChange={(e) => setModel(i, { vision: e.target.checked })}
            />
            vision
          </label>
        </div>
      ))}
      <div className="providers-form-row">
        <button
          type="button"
          onClick={() => setModels((ms) => [...ms, { ...EMPTY_MODEL }])}
        >
          + model
        </button>
        <button type="submit">Add endpoint</button>
      </div>
      {error ? <p className="providers-error">{error}</p> : null}
    </form>
  );
}
