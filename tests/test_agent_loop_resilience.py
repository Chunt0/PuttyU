"""Resilience regressions for the agent loop's failure paths.

1. A tool implementation that CRASHES (raises) must not kill the SSE generator
   after tool_start was already emitted — the crash becomes a normal error
   tool_output (exit_code 1) fed back to the model, and the stream still
   terminates with [DONE]. Before the guard, the exception escaped at
   `await _tool_task` and the client hung with a spinner forever.

2. A native function call naming a nonexistent tool must not silently end the
   turn: previously every failed conversion was dropped, the round looked
   tool-free, and the loop broke as if the prose were a final answer. Now the
   model gets one corrective system message and the loop continues (capped at
   _MAX_UNKNOWN_TOOL_NUDGES so invented names can't loop forever).

3. McpManager.call_tool has a deadline: a wedged server (process alive,
   never responding) returns a "timed out" error dict instead of blocking the
   agent stream indefinitely.
"""

import asyncio
import json

import src.agent_loop as al
import src.mcp_manager as mm


def _collect(gen):
    async def _run():
        return [c async for c in gen]
    return asyncio.run(_run())


def _events(chunks):
    out = []
    for c in chunks:
        if c.startswith("data: ") and not c.startswith("data: [DONE]"):
            try:
                out.append(json.loads(c[6:]))
            except Exception:
                pass
    return out


def _patch_common(monkeypatch):
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default, raising=False)
    monkeypatch.setattr(al, "get_mcp_manager", lambda: None, raising=False)
    monkeypatch.setattr(al, "estimate_tokens", lambda *a, **k: 10, raising=False)


# ── 1. crashing tool ────────────────────────────────────────────────────────

def test_tool_crash_becomes_error_output_and_stream_completes(monkeypatch):
    _patch_common(monkeypatch)

    async def _boom(block, *a, **k):
        raise RuntimeError("kaboom")
    monkeypatch.setattr(al, "execute_tool_block", _boom, raising=False)

    calls = {"n": 0}

    async def _fake_stream(_candidates, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            yield f'data: {json.dumps({"delta": "```bash\necho hi\n```"})}\n\n'
        else:
            yield f'data: {json.dumps({"delta": "done."})}\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", _fake_stream, raising=False)

    chunks = _collect(al.stream_agent_loop(
        "http://x/v1", "m",
        [{"role": "user", "content": "run it"}],
        max_rounds=3, relevant_tools={"bash"},
    ))
    events = _events(chunks)

    outs = [e for e in events if e.get("type") == "tool_output"]
    assert outs, f"no tool_output emitted after crash: {events}"
    assert outs[0].get("exit_code") == 1, outs
    assert "kaboom" in (outs[0].get("output") or ""), outs
    # The stream must still terminate cleanly.
    assert chunks[-1].startswith("data: [DONE]"), chunks[-3:]


# ── 2. hallucinated native tool name ────────────────────────────────────────

def test_unknown_native_tool_gets_feedback_not_silent_end(monkeypatch):
    _patch_common(monkeypatch)

    seen = {}
    calls = {"n": 0}

    async def _fake_stream(_candidates, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            # Model emits a native call for a tool that doesn't exist.
            yield f'data: {json.dumps({"type": "tool_calls", "calls": [{"name": "make_it_so", "arguments": "{}"}]})}\n\n'
        else:
            seen["system_msgs"] = [m["content"] for m in messages if m.get("role") == "system"]
            yield f'data: {json.dumps({"delta": "ok, answering directly."})}\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", _fake_stream, raising=False)

    chunks = _collect(al.stream_agent_loop(
        "http://x/v1", "m",
        [{"role": "user", "content": "engage"}],
        max_rounds=3, relevant_tools={"bash"},
    ))

    # The turn must NOT end on round 1 — the model gets a second round.
    assert calls["n"] >= 2, "loop ended silently on the failed native call"
    assert any("make_it_so" in c for c in seen.get("system_msgs", [])), seen
    assert chunks[-1].startswith("data: [DONE]")


def test_unknown_native_tool_nudge_is_capped(monkeypatch):
    _patch_common(monkeypatch)
    calls = {"n": 0}

    async def _always_bogus(_candidates, messages, **kwargs):
        calls["n"] += 1
        yield f'data: {json.dumps({"type": "tool_calls", "calls": [{"name": "make_it_so", "arguments": "{}"}]})}\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", _always_bogus, raising=False)

    chunks = _collect(al.stream_agent_loop(
        "http://x/v1", "m",
        [{"role": "user", "content": "engage"}],
        max_rounds=10, relevant_tools={"bash"},
    ))
    # 1 initial round + at most _MAX_UNKNOWN_TOOL_NUDGES retries.
    assert calls["n"] <= 3, f"nudge not capped: {calls['n']} rounds"
    assert chunks[-1].startswith("data: [DONE]")


# ── 3. wedged MCP server ────────────────────────────────────────────────────

def test_wedged_mcp_tool_call_times_out(monkeypatch):
    mgr = mm.McpManager()

    class _WedgedSession:
        async def call_tool(self, name, args):
            await asyncio.sleep(60)

    mgr._sessions["srv"] = _WedgedSession()
    monkeypatch.setattr(mm.McpManager, "TOOL_CALL_TIMEOUT_S", 0.05, raising=False)
    monkeypatch.setattr(mgr, "is_builtin", lambda sid: False)

    result = asyncio.run(mgr.call_tool("mcp__srv__slow_tool", {}))
    assert result.get("exit_code") == 1, result
    assert "timed out" in result.get("error", ""), result
