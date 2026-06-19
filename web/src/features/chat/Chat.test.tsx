import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat.tsx";
import { useUiStore } from "../../lib/store.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { useToastStore } from "../../components/toast.ts";
import { renderWithProviders, jsonResponse, sseResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ currentSessionId: null });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
  useToastStore.setState({ toasts: [] });
});

describe("Chat", () => {
  it("prompts to pick a chat when no session is selected", () => {
    renderWithProviders(<Chat />);
    expect(screen.getByText(/select a chat/i)).toBeInTheDocument();
  });

  it("renders server history for the current session", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () =>
        jsonResponse({
          history: [
            { role: "user", content: "what is a sample?" },
            { role: "assistant", content: "a subset of a population" },
          ],
          model: "m",
          name: "Stats",
        }),
      ],
    ]);
    renderWithProviders(<Chat />);
    expect(await screen.findByText("what is a sample?")).toBeInTheDocument();
    expect(screen.getByText("a subset of a population")).toBeInTheDocument();
  });

  it("streams an assistant reply and merges it back to history", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    let historyCalls = 0;
    stubFetch([
      ["/api/history/", () => {
        historyCalls += 1;
        // First load empty; after the turn completes the refetch returns the saved reply.
        return jsonResponse(
          historyCalls === 1
            ? { history: [], model: "m", name: "Stats" }
            : { history: [
                { role: "user", content: "hi" },
                { role: "assistant", content: "Streamed reply" },
              ], model: "m", name: "Stats" },
        );
      }],
      ["/api/chat_stream", () =>
        sseResponse('data: {"delta":"Streamed"}\n\ndata: {"delta":" reply"}\n\ndata: [DONE]\n\n'),
      ],
    ]);

    renderWithProviders(<Chat />);
    const box = await screen.findByLabelText("Message");
    await userEvent.type(box, "hi");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The streamed text appears in the transcript.
    await waitFor(() => expect(screen.getByText("Streamed reply")).toBeInTheDocument());
    // History was refetched (server is the source of truth post-stream).
    await waitFor(() => expect(historyCalls).toBeGreaterThanOrEqual(2));
  });

  it("renders agent tool steps and sends mode=agent", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    const fetchMock = stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "Stats" })],
      ["/api/chat_stream", () =>
        sseResponse(
          'data: {"type":"tool_start","tool":"bash","command":"ls /","round":1}\n\n' +
            'data: {"type":"tool_output","tool":"bash","command":"ls /","output":"etc\\nvar","exit_code":0,"round":1}\n\n' +
            'data: {"delta":"Here are the files."}\n\n' +
            "data: [DONE]\n\n",
        ),
      ],
    ]);

    renderWithProviders(<Chat />);
    await screen.findByLabelText("Message");

    // Turn on agent mode, then send.
    await userEvent.click(screen.getByLabelText("Agent mode"));
    await userEvent.type(screen.getByLabelText("Message"), "list the root");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The tool step renders with its name, command and output.
    expect(await screen.findByText("bash")).toBeInTheDocument();
    expect(screen.getByText("ls /")).toBeInTheDocument();
    expect(screen.getByText(/etc/)).toBeInTheDocument();

    // The request went in agent mode.
    const call = findCall(fetchMock, "/api/chat_stream", "POST");
    expect(call).toBeTruthy();
    expect((callInfo(call!).body as FormData).get("mode")).toBe("agent");
  });

  it("offers Summarize only with a non-empty, non-streaming session", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "Stats" })],
    ]);
    renderWithProviders(<Chat />);
    // Empty session: no button (welcome state).
    await screen.findByText(/what are we working on/i);
    expect(screen.queryByRole("button", { name: /summariz/i })).not.toBeInTheDocument();
  });

  it("summarizes a session: POSTs the id, toasts, and opens Notes", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    const fetchMock = stubFetch([
      ["/api/history/", () =>
        jsonResponse({
          history: [
            { role: "user", content: "what is a sample?" },
            { role: "assistant", content: "a subset of a population" },
          ],
          model: "m",
          name: "Stats",
        }),
      ],
      ["/api/sessions/s1/summary", () =>
        jsonResponse({ status: "ok", note: { id: "n1", title: "Session summary — Stats", content: "Covered…" } }),
      ],
    ]);
    renderWithProviders(<Chat />);
    await userEvent.click(await screen.findByRole("button", { name: "Summarize" }));

    // The POST fired against the session-summary route.
    await waitFor(() => expect(findCall(fetchMock, "/api/sessions/s1/summary", "POST")).toBeTruthy());
    // Success toast + the Notes window opens (the deep-link, not an auto-modal).
    await waitFor(() => expect(useWindowStore.getState().windows.notes).toBeTruthy());
    expect(useToastStore.getState().toasts.some((t) => t.kind === "success")).toBe(true);
  });

  it("too_short summary: info toast, no note saved, Notes stays closed", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () =>
        jsonResponse({
          history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
          model: "m",
          name: "Stats",
        }),
      ],
      ["/api/sessions/s1/summary", () => jsonResponse({ status: "too_short" })],
    ]);
    renderWithProviders(<Chat />);
    await userEvent.click(await screen.findByRole("button", { name: "Summarize" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.some(
        (t) => t.kind === "info" && /not much to summarize/i.test(t.text))).toBe(true));
    expect(useWindowStore.getState().windows.notes).toBeUndefined();
  });

  it("no_llm summary: info toast about no model, Notes stays closed", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () =>
        jsonResponse({
          history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
          model: "m",
          name: "Stats",
        }),
      ],
      ["/api/sessions/s1/summary", () => jsonResponse({ status: "no_llm" })],
    ]);
    renderWithProviders(<Chat />);
    await userEvent.click(await screen.findByRole("button", { name: "Summarize" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.some(
        (t) => t.kind === "info" && /no model/i.test(t.text))).toBe(true));
    expect(useWindowStore.getState().windows.notes).toBeUndefined();
  });

  it("surfaces an error if the stream fails", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "S" })],
      ["/api/chat_stream", () => new Response("no provider", { status: 500 })],
    ]);
    renderWithProviders(<Chat />);
    const box = await screen.findByLabelText("Message");
    await userEvent.type(box, "hi");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/check your provider configuration/i);
  });
});
