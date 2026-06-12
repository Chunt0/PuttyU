import { useRef, useState, type FormEvent } from "react";
import { Spinner } from "../../components/Spinner.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { streamResearch, type ResearchProgress } from "../../api/streaming.ts";
import { useResearchLibrary, useStartResearch, researchLibraryKey, reportUrl } from "./api.ts";
import type { ResearchLibraryItem } from "../../api/types.ts";

const TERMINAL = new Set(["done", "error", "cancelled", "not_found"]);

/** Turn one progress event into a human line. */
function describe(p: ResearchProgress): string {
  const phase = p.phase ?? p.status ?? "";
  switch (phase) {
    case "planning":
      return "Planning the research…";
    case "searching":
      return p.round ? `Searching (round ${p.round})` : "Searching the web…";
    case "reading":
      return `Reading: ${p.title || p.url || "a source"}`;
    case "analyzing":
      return p.round ? `Analyzing findings (round ${p.round})` : "Analyzing findings…";
    case "writing":
      return typeof p.message === "string" ? p.message : "Writing the report…";
    case "warning":
      return typeof p.message === "string" ? p.message : "Warning";
    case "error":
      return p.message || p.error || "Something went wrong";
    default:
      return typeof p.message === "string" ? p.message : phase || "Working…";
  }
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString();
}

/** Deep Research: start a job, watch streamed progress, view the HTML report; browse past runs. */
export function Research() {
  const qc = useQueryClient();
  const library = useResearchLibrary();
  const start = useStartResearch();

  const [query, setQuery] = useState("");
  const [job, setJob] = useState<{ id: string; query: string } | null>(null);
  const [events, setEvents] = useState<ResearchProgress[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = jobStatus === "running";

  async function onStart(e: FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (!text || start.isPending || running) return;
    setError(null);
    setEvents([]);
    setReport(null);
    try {
      const res = await start.mutateAsync(text);
      setJob({ id: res.session_id, query: text });
      setJobStatus("running");
      setQuery("");

      const ac = new AbortController();
      abortRef.current = ac;
      let finalStatus = "done";
      for await (const ev of streamResearch(res.session_id, ac.signal)) {
        setEvents((cur) => [...cur, ev].slice(-12));
        if (typeof ev.status === "string" && TERMINAL.has(ev.status)) finalStatus = ev.status;
      }
      setJobStatus(finalStatus);
      await qc.invalidateQueries({ queryKey: researchLibraryKey });
      if (finalStatus === "done") setReport(res.session_id);
    } catch {
      setError("Could not run research. Make sure a model provider is configured (Providers).");
      setJobStatus("error");
    }
  }

  function openReport(item: ResearchLibraryItem) {
    setJob({ id: item.id, query: item.query });
    setReport(item.id);
  }

  return (
    <section className="research">
      <h1>Deep research</h1>

      <form className="research-start" onSubmit={onStart}>
        <textarea
          aria-label="Research query"
          placeholder="What should I research? e.g. 'compare spaced-repetition algorithms for vocabulary'"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
        />
        <button type="submit" disabled={!query.trim() || running || start.isPending}>
          {running ? "Researching…" : start.isPending ? "Starting…" : "Start research"}
        </button>
        {error && <p className="research-error" role="alert">{error}</p>}
      </form>

      {job && (jobStatus === "running" || events.length > 0) && (
        <div className="research-progress" data-testid="research-progress">
          <h2>
            {running ? "Researching" : `Run ${jobStatus}`}: <span className="research-q">{job.query}</span>
          </h2>
          <ul className="research-events">
            {events.map((ev, i) => (
              <li key={i} className={`research-event research-event--${ev.phase ?? ev.status ?? ""}`}>
                {describe(ev)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && (
        <div className="research-report" data-testid="research-report">
          <div className="research-report-head">
            <h2>Report</h2>
            <button onClick={() => setReport(null)} aria-label="Close report">
              Close
            </button>
          </div>
          <iframe className="research-report-frame" title="Research report" src={reportUrl(report)} />
        </div>
      )}

      <div className="research-library">
        <h2>Library ({library.data?.length ?? 0})</h2>
        {library.isLoading && <Spinner label="Loading library…" />}
        {!library.isLoading && (library.data?.length ?? 0) === 0 && (
          <p className="research-empty">No research yet — start one above.</p>
        )}
        <ul>
          {library.data?.map((item) => (
            <li key={item.id} className="research-row">
              <button className="research-open" onClick={() => openReport(item)}>
                <span className="research-row-q">{item.query || "(untitled)"}</span>
                <span className={`research-status research-status--${item.status}`}>{item.status}</span>
                <span className="research-meta">
                  {item.source_count} source{item.source_count === 1 ? "" : "s"}
                  {item.completed_at ? ` · ${formatDate(item.completed_at)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
