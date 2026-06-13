import { Spinner } from "../../components/Spinner.tsx";
import { toast } from "../../components/toast.ts";
import type { RouterCapability, RouterPin } from "../../api/types.ts";
import { useModelEndpoints, useModels, modelChoices } from "./api.ts";
import {
  TIERS,
  useRouterConfig,
  useRouterLog,
  useRouterResolution,
  useUpdateRouterConfig,
} from "./routerApi.ts";

// Same first-"|" split trick as the default-model picker (endpoint ids are UUIDs).
const SEP = "|";
const toValue = (endpointId: string, model: string) => `${endpointId}${SEP}${model}`;

function pinValue(pin: RouterPin | undefined): string {
  if (!pin?.endpoint_id) return "";
  return toValue(pin.endpoint_id, pin.model ?? "");
}

function tsLabel(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

/**
 * Routing settings (SPEC F7): the policy dial, the LIVE tier→model resolution table
 * (observable, including degradation notes), per-tier pins, per-endpoint capability
 * tags (vision is a hard requirement; reasoning ranks candidates), and the recent
 * decision log. Cost metering is T5 — not here.
 */
export function Routing() {
  const config = useRouterConfig();
  const resolution = useRouterResolution();
  const log = useRouterLog();
  const update = useUpdateRouterConfig();
  const endpoints = useModelEndpoints();
  const models = useModels();

  const choices = modelChoices(models.data);
  const pins = config.data?.pins ?? {};
  const capabilities = config.data?.capabilities ?? {};

  function save(body: Parameters<typeof update.mutate>[0]) {
    update.mutate(body, { onError: () => toast.error("Could not save routing settings.") });
  }

  function onPolicy(policy: string) {
    save({ policy });
  }

  function onPin(tier: string, value: string) {
    const next: Record<string, RouterPin> = { ...pins };
    if (!value) {
      delete next[tier];
    } else {
      const idx = value.indexOf(SEP);
      const endpoint_id = value.slice(0, idx);
      const model = value.slice(idx + SEP.length);
      next[tier] = { endpoint_id, model: model || null };
    }
    save({ pins: next });
  }

  function onCapability(endpointId: string, patch: Partial<RouterCapability>) {
    const current = capabilities[endpointId] ?? { vision: false, reasoning: "standard" };
    save({ capabilities: { ...capabilities, [endpointId]: { ...current, ...patch } } });
  }

  const policy = config.data?.policy ?? "local_first";

  return (
    <div className="routing">
      <h2>Routing</h2>
      <p className="routing-hint">
        Call sites declare what a task needs (tier, vision); the router picks the model.
        Pin a tier or tag capabilities to override auto-resolution.
      </p>
      {config.isLoading && <Spinner label="Loading routing settings…" />}

      {config.data && (
        <>
          <fieldset className="routing-policy">
            <legend>Policy</legend>
            <label>
              <input
                type="radio"
                name="routing-policy"
                value="local_first"
                checked={policy === "local_first"}
                onChange={() => onPolicy("local_first")}
              />
              local-first — privacy and cost; background work never leaves the box
            </label>
            <label>
              <input
                type="radio"
                name="routing-policy"
                value="quality_first"
                checked={policy === "quality_first"}
                onChange={() => onPolicy("quality_first")}
              />
              quality-first — deep work goes to the best model anywhere
            </label>
          </fieldset>

          <div className="routing-resolution">
            <h3>Live resolution</h3>
            {resolution.isLoading && <Spinner label="Resolving…" />}
            {resolution.data && (
              <table className="routing-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Model</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {resolution.data.map((row) => (
                    <tr key={`${row.tier}-${row.modality}`} className={row.degraded ? "routing-row--degraded" : ""}>
                      <td>
                        {row.tier}
                        {row.modality === "vision" && <span className="routing-modality"> · vision</span>}
                      </td>
                      <td className="routing-model">
                        {row.error ? <span className="routing-error">{row.error}</span> : row.model || "—"}
                      </td>
                      <td className="routing-why">
                        {row.why}
                        {row.degraded && <span className="routing-degraded"> degraded</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="routing-pins">
            <h3>Pins</h3>
            {TIERS.map((tier) => (
              <label key={tier} className="routing-pin">
                {tier}
                <select
                  aria-label={`Pin for ${tier}`}
                  value={pinValue(pins[tier])}
                  onChange={(e) => onPin(tier, e.target.value)}
                  disabled={choices.length === 0}
                >
                  <option value="">Auto</option>
                  {choices.map((c) => (
                    <option key={toValue(c.endpoint_id, c.model)} value={toValue(c.endpoint_id, c.model)}>
                      {c.model} · {c.endpoint_name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="routing-capabilities">
            <h3>Endpoint capabilities</h3>
            {endpoints.isLoading && <Spinner label="Loading endpoints…" />}
            {endpoints.data?.length === 0 && <p className="routing-empty">No endpoints yet.</p>}
            <ul>
              {endpoints.data?.map((ep) => {
                const cap = capabilities[ep.id];
                return (
                  <li key={ep.id} className="routing-cap-row">
                    <span className="routing-cap-name">{ep.name}</span>
                    <label className="routing-cap-vision">
                      <input
                        type="checkbox"
                        aria-label={`${ep.name} vision capable`}
                        checked={cap?.vision ?? false}
                        onChange={(e) => onCapability(ep.id, { vision: e.target.checked })}
                      />
                      vision
                    </label>
                    <label className="routing-cap-reasoning">
                      reasoning
                      <select
                        aria-label={`${ep.name} reasoning tier`}
                        value={cap?.reasoning ?? "standard"}
                        onChange={(e) => onCapability(ep.id, { reasoning: e.target.value })}
                      >
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="routing-log">
            <h3>Recent decisions</h3>
            {log.data && log.data.length === 0 && <p className="routing-empty">No routed calls yet.</p>}
            <ul>
              {log.data?.map((e, i) => (
                <li key={i} className="routing-log-row">
                  <span className="routing-log-ts">{tsLabel(e.ts)}</span>
                  <span className="routing-log-model">{e.model || "—"}</span>
                  <span className="routing-log-why">{e.why}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
