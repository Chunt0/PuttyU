"""Completion verifier for the agent loop (split out of agent_loop.py, Gate 6a).

A fresh-context "did it actually do the work?" check: after an effectful
agentic turn claims completion, a second model instance with NO shared history
reads the user's request plus a compact record of the tools that ran and
judges whether the claim holds. See stream_agent_loop's verifier block for the
wiring (opt-in via the `agent_verifier_subagent` setting).
"""

import logging
import re

logger = logging.getLogger(__name__)

# Tools whose effects produce a checkable artifact. A turn that used one of
# these is "effectful" and worth an independent completion check; pure
# read-only / Q&A turns are not.
_VERIFIER_EFFECTFUL_TOOLS = {
    "create_document", "update_document", "edit_document",
    "bash", "python", "write_file",
}
_VERIFIER_MAX_ROUNDS = 2  # cap re-verify cycles per turn — never loop forever


def _build_actions_snapshot(tool_events: list, limit: int = 8000) -> str:
    """Compact record of what the agent actually did this turn, for the
    verifier to judge against. One block per tool execution: the command and
    a head of its output."""
    parts = []
    for ev in tool_events:
        tool = ev.get("tool", "?")
        cmd = (ev.get("command") or "").strip()
        out = (ev.get("output") or "").strip()
        rc = ev.get("exit_code")
        head = f"[{tool}] {cmd}" if cmd else f"[{tool}]"
        rc_s = f" (exit {rc})" if rc not in (None, 0) else ""
        body = (out[:1200] + " …") if len(out) > 1200 else (out or "(no output)")
        parts.append(f"{head}{rc_s}\n-> {body}")
    snap = "\n\n".join(parts)
    return snap[:limit] if len(snap) > limit else snap


async def _run_verifier_subagent(
    instruction: str, actions_snapshot: str,
    *, endpoint_url: str, model: str, headers: dict,
) -> list:
    """Fresh-context completion verifier. A second model instance with NO
    shared history reads the user's request + a record of what the agent did
    and judges whether the task is genuinely complete. The independent context
    is the whole point: a model checking its own work rationalizes; one that
    didn't do the work reads it cold. Returns a list of failure reasons
    (empty = pass, or silently empty on any error so it can't block a valid
    completion)."""
    from src.llm_core import llm_call_async
    prompt = (
        "You are an independent verifier. Another assistant just claimed the "
        "following task is complete. Using ONLY the request and the record of "
        "what it actually did, decide whether that claim is correct. Be strict: "
        "only say SUCCESS if the work genuinely satisfies the request.\n\n"
        f"<user_request>\n{(instruction or '')[:4000]}\n</user_request>\n\n"
        f"<actions_taken>\n{actions_snapshot[:8000]}\n</actions_taken>\n\n"
        "<checklist>\n"
        "1. Every concrete deliverable the request asked for was actually produced\n"
        "2. Outputs/edits match what was asked — nothing missing, no extra or unrequested changes\n"
        "3. Tool results show success, not errors or empty output that got ignored\n"
        "4. Anything the request said to leave alone was left unchanged\n"
        "</checklist>\n\n"
        "Reason briefly (2-3 sentences max). Then output EXACTLY one of:\n"
        "  VERIFICATION: SUCCESS\n"
        "  VERIFICATION: FAIL: <one short sentence per issue, semicolon-separated>\n"
        "Output nothing after the VERIFICATION line."
    )
    try:
        raw = await llm_call_async(
            url=endpoint_url, model=model,
            messages=[{"role": "user", "content": prompt}],
            headers=headers, temperature=0.0, max_tokens=600, timeout=60,
        )
    except Exception as e:
        logger.warning(f"[agent] verifier subagent failed: {e}")
        return []
    raw = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.DOTALL | re.IGNORECASE)
    last_v = None
    for line in raw.splitlines():
        if "VERIFICATION:" in line:
            last_v = line.strip()
    if not last_v or "VERIFICATION: FAIL:" not in last_v:
        return []
    reasons = last_v.split("VERIFICATION: FAIL:", 1)[1].strip()
    return [r.strip() for r in reasons.split(";") if r.strip()]
