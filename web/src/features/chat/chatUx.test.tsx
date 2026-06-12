/** UX-layer chat tests: attachments, stop-generation, welcome state, message copy. */
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

/** An SSE response that emits one delta then stays open until the request aborts —
 * mirrors a real fetch stream so the stop button path is exercised end to end. */
function hangingSse(signal?: AbortSignal | null): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"delta":"partial"}\n\n'));
      signal?.addEventListener("abort", () => {
        c.error(new DOMException("aborted", "AbortError"));
      });
    },
  });
  return new Response(stream, { status: 200 });
}

describe("Chat UX", () => {
  it("shows the tutor welcome on an empty session", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([["/api/history/", () => jsonResponse({ history: [], model: "m", name: "New chat" })]]);
    renderWithProviders(<Chat />);
    expect(await screen.findByText(/what are we working on today/i)).toBeInTheDocument();
  });

  it("uploads picked files and sends their ids as attachments", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    const fetchMock = stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "S" })],
      ["/api/upload", () =>
        jsonResponse({ files: [{ id: "f1", name: "worksheet.png", mime: "image/png", size: 10 }] }),
      ],
      ["/api/chat_stream", () => sseResponse('data: {"delta":"ok"}\n\ndata: [DONE]\n\n')],
    ]);

    renderWithProviders(<Chat />);
    await screen.findByLabelText("Message");

    const file = new File(["x"], "worksheet.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Attach files"), file);

    // The chip appears once the upload resolves.
    expect(await screen.findByText("worksheet.png")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message"), "check my work");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const call = findCall(fetchMock, "/api/chat_stream", "POST");
      expect(call).toBeTruthy();
      const form = callInfo(call!).body as FormData;
      expect(form.get("attachments")).toBe(JSON.stringify(["f1"]));
    });
    // Chips clear after send.
    await waitFor(() => expect(screen.queryByText("worksheet.png")).not.toBeInTheDocument());
  });

  it("removes an attachment chip before sending", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "S" })],
      ["/api/upload", () =>
        jsonResponse({ files: [{ id: "f1", name: "notes.txt", mime: "text/plain", size: 5 }] }),
      ],
    ]);
    renderWithProviders(<Chat />);
    await screen.findByLabelText("Message");
    await userEvent.upload(
      screen.getByLabelText("Attach files"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    await screen.findByText("notes.txt");
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("stop aborts the stream without surfacing an error", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () => jsonResponse({ history: [], model: "m", name: "S" })],
      ["/api/chat_stream", (_url, init) => hangingSse(init?.signal)],
    ]);

    renderWithProviders(<Chat />);
    const box = await screen.findByLabelText("Message");
    await userEvent.type(box, "go");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // Streaming: the partial text and the stop button are visible.
    expect(await screen.findByText("partial")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    // Back to idle: send returns, no error alert.
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copies a message's raw text", async () => {
    useUiStore.setState({ currentSessionId: "s1" });
    stubFetch([
      ["/api/history/", () =>
        jsonResponse({
          history: [{ role: "assistant", content: "x = 4" }],
          model: "m",
          name: "S",
        }),
      ],
    ]);
    const user = userEvent.setup(); // installs a clipboard stub in jsdom
    renderWithProviders(<Chat />);
    await screen.findByText("x = 4");
    await user.click(screen.getByRole("button", { name: "Copy message" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe("x = 4");
  });
});
