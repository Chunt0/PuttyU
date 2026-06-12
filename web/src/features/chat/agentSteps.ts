/**
 * Pure reducer that folds the agent loop's SSE control events into renderable state.
 *
 * The agent stream (POST /api/chat_stream with mode=agent) interleaves text `delta`s with
 * control events. The tool ones (confirmed against src/agent_loop.py) are:
 *   tool_start  { type, tool, command, round }
 *   tool_output { type, tool, command, output, exit_code?, round }
 *   plan_update { type, data: { plan } }       // plan-mode checklist write-back
 * A `tool_output` is paired to its `tool_start` by the most recent still-running step with
 * the same (tool, round). Kept pure so Chat.tsx stays thin and this is unit-testable.
 */
import type { ChatEvent } from "../../api/streaming.ts";

export interface ToolStep {
  tool: string;
  command: string;
  output: string | null; // null while running
  exitCode: number | null;
  round: number;
}

export interface AgentState {
  steps: ToolStep[];
  plan: string | null;
}

export const emptyAgentState: AgentState = { steps: [], plan: null };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOr = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

export function reduceAgentEvent(state: AgentState, ev: ChatEvent): AgentState {
  if (ev.kind !== "control") return state;
  const p = ev.payload;

  if (ev.event === "tool_start") {
    const step: ToolStep = {
      tool: str(p.tool),
      command: str(p.command),
      output: null,
      exitCode: null,
      round: numOr(p.round, 0),
    };
    return { ...state, steps: [...state.steps, step] };
  }

  if (ev.event === "tool_output") {
    const tool = str(p.tool);
    const round = numOr(p.round, 0);
    const output = str(p.output);
    const exitCode = typeof p.exit_code === "number" ? p.exit_code : null;

    // Complete the most recent still-running step for this (tool, round).
    let idx = -1;
    for (let i = state.steps.length - 1; i >= 0; i--) {
      const s = state.steps[i];
      if (s.tool === tool && s.round === round && s.output === null) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      // Output with no matching start — surface it as its own completed step.
      return {
        ...state,
        steps: [...state.steps, { tool, command: str(p.command), output, exitCode, round }],
      };
    }
    const steps = state.steps.slice();
    steps[idx] = { ...steps[idx], output, exitCode };
    return { ...state, steps };
  }

  if (ev.event === "plan_update") {
    const data = p.data;
    if (data && typeof data === "object") {
      const plan = (data as Record<string, unknown>).plan;
      if (typeof plan === "string") return { ...state, plan };
    }
    return state;
  }

  return state;
}
