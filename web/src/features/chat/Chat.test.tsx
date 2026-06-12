import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat.tsx";
import { useUiStore } from "../../lib/store.ts";
import { renderWithProviders, jsonResponse, sseResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ currentSessionId: null });
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
