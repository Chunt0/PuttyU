import { useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { ConfirmButton } from "../../components/ConfirmButton.tsx";
import {
  useModelEndpoints,
  useModels,
  useDefaultChat,
  useCreateEndpoint,
  useDeleteEndpoint,
  useSetEndpointEnabled,
  useSetDefaultChat,
  modelChoices,
} from "./api.ts";

// Endpoint ids are UUIDs (never contain "|"); we split on the FIRST "|" so a model id that
// happens to contain "|" still parses correctly.
const CHOICE_SEP = "|";
const toValue = (endpointId: string, model: string) => `${endpointId}${CHOICE_SEP}${model}`;

/** Settings -> Providers: connect/edit/remove LLM endpoints and pick the default chat model. */
export function Providers() {
  const endpoints = useModelEndpoints();
  const models = useModels();
  const defaultChat = useDefaultChat();
  const createEndpoint = useCreateEndpoint();
  const deleteEndpoint = useDeleteEndpoint();
  const setEnabled = useSetEndpointEnabled();
  const setDefault = useSetDefaultChat();

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const choices = modelChoices(models.data);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!baseUrl.trim()) return;
    try {
      await createEndpoint.mutateAsync({
        name: name.trim() || undefined,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
      });
      setName("");
      setBaseUrl("");
      setApiKey("");
    } catch {
      setError("Could not add that endpoint. Check the URL is reachable.");
    }
  }

  function onPickDefault(value: string) {
    const idx = value.indexOf(CHOICE_SEP);
    if (idx === -1) return;
    const endpoint_id = value.slice(0, idx);
    const model = value.slice(idx + CHOICE_SEP.length);
    const choice = choices.find((c) => c.endpoint_id === endpoint_id && c.model === model);
    if (choice) setDefault.mutate(choice);
  }

  const current = defaultChat.data;
  const currentValue = current?.endpoint_id && current.model ? toValue(current.endpoint_id, current.model) : "";

  return (
    <section className="providers">
      <h1>Providers &amp; models</h1>

      <div className="provider-default">
        <label>
          Default chat model
          <select
            aria-label="Default chat model"
            value={currentValue}
            onChange={(e) => onPickDefault(e.target.value)}
            disabled={choices.length === 0}
          >
            <option value="" disabled>
              {choices.length === 0 ? "No models — add an endpoint" : "Select a model…"}
            </option>
            {choices.map((c) => (
              <option key={toValue(c.endpoint_id, c.model)} value={toValue(c.endpoint_id, c.model)}>
                {c.model} · {c.endpoint_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form className="provider-add" onSubmit={onAdd}>
        <h2>Add an endpoint</h2>
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Endpoint name" />
        <input placeholder="Base URL (e.g. http://localhost:11434/v1)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Base URL" />
        <p className="provider-hint">
          Use the OpenAI-compatible base — include the <code>/v1</code> suffix (e.g. Ollama:
          <code> http://host:11434/v1</code>). Without it, models list but chat fails.
        </p>
        <input placeholder="API key (optional)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label="API key" type="password" />
        <button type="submit" disabled={!baseUrl.trim() || createEndpoint.isPending}>
          {createEndpoint.isPending ? "Adding…" : "Add"}
        </button>
        {error && <p className="provider-error" role="alert">{error}</p>}
      </form>

      <div className="provider-list">
        <h2>Endpoints</h2>
        {endpoints.isLoading && <Spinner label="Loading endpoints…" />}
        {endpoints.data?.length === 0 && <p className="provider-empty">No endpoints yet.</p>}
        <ul>
          {endpoints.data?.map((ep) => (
            <li key={ep.id} className="provider-row">
              <span
                className={`provider-status provider-status--${ep.online ? "online" : "offline"}`}
                title={ep.status}
                aria-label={ep.online ? "online" : "offline"}
              >
                ●
              </span>
              <span className="provider-name">{ep.name}</span>
              <span className="provider-url">{ep.base_url}</span>
              <span className="provider-models">
                {ep.models.length} model{ep.models.length === 1 ? "" : "s"}
              </span>
              <button onClick={() => setEnabled.mutate({ id: ep.id, is_enabled: !ep.is_enabled })}>
                {ep.is_enabled ? "Disable" : "Enable"}
              </button>
              <ConfirmButton
                className="provider-delete"
                title={`Delete ${ep.name}`}
                onConfirm={() => deleteEndpoint.mutate(ep.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
