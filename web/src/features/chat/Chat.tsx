import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "../../lib/store.ts";
import { streamChat } from "../../api/streaming.ts";
import { historyKey, useHistory } from "./api.ts";
import { reduceAgentEvent, emptyAgentState, type AgentState, type ToolStep } from "./agentSteps.ts";
import { Message } from "./Message.tsx";
import { Composer } from "./Composer.tsx";
import type { UploadedFile } from "./attachments.ts";

interface Pending {
  user: string;
  assistant: string;
}

function stepStatus(s: ToolStep): { label: string; cls: string } {
  if (s.output === null) return { label: "running…", cls: "running" };
  if (s.exitCode !== null && s.exitCode !== 0) return { label: `exit ${s.exitCode}`, cls: "error" };
  return { label: "done", cls: "done" };
}

/** The agent loop's tool steps + plan checklist for the in-flight turn (transient). */
function AgentSteps({ state }: { state: AgentState }) {
  if (state.steps.length === 0 && !state.plan) return null;
  return (
    <div className="agent-steps" data-testid="agent-steps">
      {state.steps.map((s, i) => {
        const st = stepStatus(s);
        return (
          <div key={i} className="tool-step">
            <div className="tool-step-head">
              <span className="tool-name">{s.tool}</span>
              {s.command && <code className="tool-cmd">{s.command}</code>}
              <span className={`tool-status tool-status--${st.cls}`}>{st.label}</span>
            </div>
            {s.output !== null && s.output !== "" && <pre className="tool-output">{s.output}</pre>}
          </div>
        );
      })}
      {state.plan && (
        <div className="agent-plan" data-testid="agent-plan">
          <span className="agent-plan-label">Plan</span>
          <pre>{state.plan}</pre>
        </div>
      )}
    </div>
  );
}

/** Tutor-framed empty state for a fresh session. */
function Welcome() {
  return (
    <div className="chat-welcome">
      <img src="/putty-blob.svg" alt="" width={40} height={40} />
      <h2>What are we working on today?</h2>
      <p>
        Ask a question, paste a problem, or attach a photo of your work — handwriting is
        fine. Nothing is too small to ask.
      </p>
    </div>
  );
}

/**
 * Chat screen. Past turns come from the history query (server state, single source of
 * truth); the in-flight turn is transient local state streamed via streamChat and merged
 * into the server history once complete. In agent mode the stream also carries tool-call
 * events (tool_start/tool_output/plan_update), rendered inline for the live turn.
 */
export function Chat() {
  const sessionId = useUiStore((s) => s.currentSessionId);
  const qc = useQueryClient();
  const history = useHistory(sessionId);

  const [pending, setPending] = useState<Pending | null>(null);
  const [agent, setAgent] = useState<AgentState>(emptyAgentState);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the stream unless the user scrolled up

  // Cancel any in-flight stream when leaving / switching session.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    setPending(null);
    setAgent(emptyAgentState);
    setError(null);
    stickRef.current = true;
  }, [sessionId]);

  const messages = history.data?.history ?? [];

  // Auto-scroll: keep the newest content in view while streaming, but respect a reader
  // who scrolled up (stick re-engages when they return to the bottom).
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending?.assistant, agent.steps.length]);

  function onScroll() {
    const el = transcriptRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function onStop() {
    abortRef.current?.abort();
  }

  async function onSend(text: string, attachments: UploadedFile[]) {
    if (!sessionId || streaming) return;

    setError(null);
    setPending({ user: text, assistant: "" });
    setAgent(emptyAgentState);
    setStreaming(true);
    stickRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const base = {
        message: text,
        session: sessionId,
        attachments: attachments.map((f) => f.id),
      };
      const req = agentMode
        ? { ...base, mode: "agent" as const, plan_mode: planMode, allow_bash: true, allow_web_search: true }
        : { ...base, mode: "chat" as const };

      for await (const ev of streamChat(req, ac.signal)) {
        if (ev.kind === "delta") {
          setPending((p) => (p ? { ...p, assistant: p.assistant + ev.text } : p));
        } else if (ev.kind === "control") {
          if (ev.event === "error") {
            // Backend run died mid-stream; it still terminates with [DONE],
            // but without this the failure would be invisible to the user.
            setError(typeof ev.payload.error === "string" ? ev.payload.error : "The response ended early.");
          }
          setAgent((a) => reduceAgentEvent(a, ev));
        } else if (ev.kind === "done") {
          break;
        }
      }
      await qc.invalidateQueries({ queryKey: historyKey(sessionId) });
      setPending(null);
      // Keep the turn's tool steps visible (history doesn't store them); they clear on the
      // next send or a session switch.
    } catch {
      if (ac.signal.aborted) {
        // User pressed stop: the server keeps whatever it persisted — resync and move on.
        await qc.invalidateQueries({ queryKey: historyKey(sessionId) });
        setPending(null);
      } else {
        setError("Could not get a response. Check your provider configuration (Providers).");
      }
    } finally {
      setStreaming(false);
    }
  }

  if (!sessionId) {
    return (
      <section className="chat chat--empty">
        <p>Select a chat or start a new one.</p>
      </section>
    );
  }

  return (
    <section className="chat">
      <header className="chat-head">
        <span className="chat-title">{history.data?.name || "Chat"}</span>
        {history.data?.model && <span className="chat-model">{history.data.model}</span>}
      </header>
      <div className="chat-transcript" data-testid="transcript" ref={transcriptRef} onScroll={onScroll}>
        {messages.length === 0 && !pending && !history.isLoading && <Welcome />}
        {messages.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}
        {/* Footer: the just-completed turn's tool steps (history doesn't persist them). */}
        {!pending && <AgentSteps state={agent} />}
        {pending && (
          <>
            <Message role="user" content={pending.user} />
            <AgentSteps state={agent} />
            {pending.assistant ? (
              <Message role="assistant" content={pending.assistant} />
            ) : (
              streaming && (
                <div className="msg msg--assistant">
                  <span className="msg-role">assistant</span>
                  <div className="msg-content msg-thinking" aria-label="Thinking">
                    <span className="msg-dot" />
                    <span className="msg-dot" />
                    <span className="msg-dot" />
                  </div>
                </div>
              )
            )}
          </>
        )}
        {error && <p className="chat-error" role="alert">{error}</p>}
      </div>

      <Composer
        streaming={streaming}
        onSend={(text, atts) => void onSend(text, atts)}
        onStop={onStop}
        agentMode={agentMode}
        setAgentMode={setAgentMode}
        planMode={planMode}
        setPlanMode={setPlanMode}
      />
    </section>
  );
}
