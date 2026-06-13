import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSSE, decodeChatEvent, streamChat, type ChatEvent } from "./streaming.ts";

function streamOf(text: string, chunkSize = text.length): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("parseSSE", () => {
  it("decodes events split across read chunks", async () => {
    const wire = "data: hello\n\ndata: world\n\n";
    // 7-byte chunks force events to span reads — exercises the buffering.
    const msgs = await collect(parseSSE(streamOf(wire, 7)));
    expect(msgs.map((m) => m.data)).toEqual(["hello", "world"]);
    expect(msgs[0].event).toBe("message");
  });

  it("joins multi-line data and honours event/id fields", async () => {
    const wire = "event: tick\nid: 9\ndata: a\ndata: b\n\n";
    const [msg] = await collect(parseSSE(streamOf(wire)));
    expect(msg).toEqual({ event: "tick", id: "9", data: "a\nb" });
  });
});

describe("decodeChatEvent", () => {
  it("maps {delta} to a text event", () => {
    expect(decodeChatEvent('{"delta":"Hi"}')).toEqual({ kind: "delta", text: "Hi" });
  });
  it("maps {type,...} to a control event keeping the payload", () => {
    expect(decodeChatEvent('{"type":"tool_start","tool":"bash"}')).toEqual({
      kind: "control",
      event: "tool_start",
      payload: { type: "tool_start", tool: "bash" },
    });
  });
  it("maps [DONE] to done, and rejects garbage", () => {
    expect(decodeChatEvent("[DONE]")).toEqual({ kind: "done" });
    expect(decodeChatEvent("not json")).toBeNull();
    expect(decodeChatEvent("42")).toBeNull();
  });
  it("maps {type:'citations'} to a typed citations event, dropping malformed entries", () => {
    const wire = JSON.stringify({
      type: "citations",
      data: [
        {
          chunk_id: "ch1",
          source_id: "s1",
          title: "Intro Stats",
          heading: "Ch 1 > 1.1 Definitions",
          page_start: 9,
          citation: "[Intro Stats §1.1 Definitions, p. 9]",
        },
        { no_source_id: true }, // malformed — must be dropped, not thrown
        { source_id: "s2", page_start: null }, // minimal — defaults fill in
      ],
    });
    expect(decodeChatEvent(wire)).toEqual({
      kind: "citations",
      items: [
        {
          chunk_id: "ch1",
          source_id: "s1",
          title: "Intro Stats",
          heading: "Ch 1 > 1.1 Definitions",
          page_start: 9,
          citation: "[Intro Stats §1.1 Definitions, p. 9]",
        },
        { chunk_id: "", source_id: "s2", title: "", heading: "", page_start: null, citation: "" },
      ],
    });
  });
  it("treats citations without a data array as a plain control event", () => {
    expect(decodeChatEvent('{"type":"citations"}')).toEqual({
      kind: "control",
      event: "citations",
      payload: { type: "citations" },
    });
  });
  it("maps a typeless backend failure payload to an error control event", () => {
    // agent_runs publishes {"error": ..., "status": 500} when a run dies
    // mid-stream — it must surface, not be dropped as unrecognised.
    expect(decodeChatEvent('{"error":"Agent run failed before completion.","status":500}')).toEqual({
      kind: "control",
      event: "error",
      payload: { error: "Agent run failed before completion.", status: 500 },
    });
  });
});

describe("streamChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields deltas, control events, then done — and stops at [DONE]", async () => {
    const wire =
      'data: {"type":"model_info","model":"m"}\n\n' +
      'data: {"delta":"Hel"}\n\n' +
      'data: {"delta":"lo"}\n\n' +
      "data: [DONE]\n\n" +
      'data: {"delta":"AFTER"}\n\n'; // must be ignored — stream ends at [DONE]
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamOf(wire), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect<ChatEvent>(
      streamChat({ message: "hi", session: "s1", mode: "chat", course_id: "c1" }),
    );
    expect(events).toEqual([
      { kind: "control", event: "model_info", payload: { type: "model_info", model: "m" } },
      { kind: "delta", text: "Hel" },
      { kind: "delta", text: "lo" },
      { kind: "done" },
    ]);

    // posted as form-data to the streaming endpoint, same-origin
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat_stream");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.body as FormData).get("message")).toBe("hi");
    expect((init.body as FormData).get("session")).toBe("s1");
    // the F3 grounding fallback rides along when a course tab is active
    expect((init.body as FormData).get("course_id")).toBe("c1");
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(collect(streamChat({ message: "x", session: "s" }))).rejects.toThrow(/401/);
  });
});
