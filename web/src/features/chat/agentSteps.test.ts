import { describe, it, expect } from "vitest";
import { reduceAgentEvent, emptyAgentState } from "./agentSteps.ts";
import type { ChatEvent } from "../../api/streaming.ts";

const control = (event: string, payload: Record<string, unknown>): ChatEvent => ({
  kind: "control",
  event,
  payload: { type: event, ...payload },
});

describe("reduceAgentEvent", () => {
  it("opens a running step on tool_start", () => {
    const s = reduceAgentEvent(emptyAgentState, control("tool_start", { tool: "bash", command: "ls /", round: 1 }));
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ tool: "bash", command: "ls /", output: null, round: 1 });
  });

  it("completes the matching step on tool_output", () => {
    let s = reduceAgentEvent(emptyAgentState, control("tool_start", { tool: "bash", command: "ls /", round: 1 }));
    s = reduceAgentEvent(s, control("tool_output", { tool: "bash", output: "etc\nvar", exit_code: 0, round: 1 }));
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ tool: "bash", output: "etc\nvar", exitCode: 0 });
  });

  it("pairs output to the most recent running step of the same (tool, round)", () => {
    let s = emptyAgentState;
    s = reduceAgentEvent(s, control("tool_start", { tool: "bash", command: "a", round: 1 }));
    s = reduceAgentEvent(s, control("tool_start", { tool: "bash", command: "b", round: 1 }));
    s = reduceAgentEvent(s, control("tool_output", { tool: "bash", output: "second done", round: 1 }));
    expect(s.steps[0].output).toBeNull(); // first still running
    expect(s.steps[1].output).toBe("second done");
  });

  it("surfaces an orphan tool_output as its own completed step", () => {
    const s = reduceAgentEvent(emptyAgentState, control("tool_output", { tool: "read_file", output: "x", round: 1 }));
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ tool: "read_file", output: "x" });
  });

  it("captures a non-zero exit code", () => {
    let s = reduceAgentEvent(emptyAgentState, control("tool_start", { tool: "bash", command: "false", round: 1 }));
    s = reduceAgentEvent(s, control("tool_output", { tool: "bash", output: "", exit_code: 1, round: 1 }));
    expect(s.steps[0].exitCode).toBe(1);
  });

  it("tracks the plan from plan_update", () => {
    const s = reduceAgentEvent(emptyAgentState, control("plan_update", { data: { plan: "- [x] step 1\n- [ ] step 2" } }));
    expect(s.plan).toBe("- [x] step 1\n- [ ] step 2");
  });

  it("ignores delta and unknown control events", () => {
    let s = reduceAgentEvent(emptyAgentState, { kind: "delta", text: "hi" });
    expect(s).toBe(emptyAgentState);
    s = reduceAgentEvent(emptyAgentState, control("metrics", { data: {} }));
    expect(s.steps).toHaveLength(0);
  });
});
