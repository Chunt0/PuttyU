import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { Markdown } from "./Markdown.tsx";
import { Toasts } from "./Toasts.tsx";
import { toast, useToastStore } from "./toast.ts";

describe("ConfirmButton", () => {
  it("requires two clicks to confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton onConfirm={onConfirm} label="Delete" />);

    const btn = screen.getByRole("button", { name: "Delete" }); // aria-label stays stable
    await user.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(btn).toHaveTextContent("Sure?"); // armed state shows the confirm label
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(btn).toHaveTextContent("Delete"); // back to resting after confirming
  });

  it("disarms when focus leaves", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmButton onConfirm={onConfirm} label="Delete" />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.tab(); // blur
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("toasts", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("renders pushed toasts and dismisses on click", async () => {
    const user = userEvent.setup();
    render(<Toasts />);
    act(() => toast.success("Saved"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await user.click(screen.getByText("Saved"));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("auto-dismisses after the timeout", () => {
    vi.useFakeTimers();
    try {
      render(<Toasts />);
      act(() => toast.error("Boom"));
      expect(screen.getByText("Boom")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(4100));
      expect(screen.queryByText("Boom")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Markdown", () => {
  it("renders gfm: headings, code blocks, tables", () => {
    const src = [
      "# Title",
      "",
      "Some **bold** text.",
      "",
      "```python",
      "print('hi')",
      "```",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    render(<Markdown>{src}</Markdown>);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("does not render raw html", () => {
    render(<Markdown>{'<img src=x onerror="boom()">hello'}</Markdown>);
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens links in a new tab", () => {
    render(<Markdown>{"[site](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
