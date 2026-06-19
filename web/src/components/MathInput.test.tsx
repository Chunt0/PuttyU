import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MathInput } from "./MathInput.tsx";

describe("MathInput", () => {
  it("opens the panel from an idle button", async () => {
    render(<MathInput onInsert={() => undefined} />);
    expect(screen.queryByTestId("mathinput")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    expect(screen.getByTestId("mathinput")).toBeInTheDocument();
    expect(screen.getByLabelText("LaTeX equation")).toBeInTheDocument();
  });

  it("renders a live KaTeX preview from typed LaTeX and inserts delimited block math", async () => {
    const onInsert = vi.fn();
    render(<MathInput onInsert={onInsert} />);

    await userEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    await userEvent.type(screen.getByLabelText("LaTeX equation"), "x^2");

    // The preview renders through the SAME Markdown/KaTeX pipeline (preview uses $$…$$).
    const preview = screen.getByTestId("mathinput-preview");
    expect(within(preview).getByText((_, el) => el?.classList.contains("katex") ?? false)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    // Block-delimited LaTeX, trimmed — never raw ASCII; only $$…$$ renders under
    // singleDollarTextMath:false.
    expect(onInsert).toHaveBeenCalledWith("$$x^2$$");
    // Panel closes after insert.
    expect(screen.queryByTestId("mathinput")).not.toBeInTheDocument();
  });

  it("restores focus to the idle button when the panel closes", async () => {
    render(<MathInput onInsert={() => undefined} />);
    const openBtn = screen.getByRole("button", { name: "Insert equation" });
    await userEvent.click(openBtn);
    await userEvent.type(screen.getByLabelText("LaTeX equation"), "{Escape}");
    // After close the idle button is back and holds focus (a11y, no trap).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Insert equation" })).toHaveFocus());
  });

  it("Insert is disabled until there's LaTeX; Cancel closes without inserting", async () => {
    const onInsert = vi.fn();
    render(<MathInput onInsert={onInsert} />);

    await userEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("LaTeX equation"), "a+b");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mathinput")).not.toBeInTheDocument();
  });

  it("Escape closes the panel", async () => {
    render(<MathInput onInsert={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    await userEvent.type(screen.getByLabelText("LaTeX equation"), "{Escape}");
    expect(screen.queryByTestId("mathinput")).not.toBeInTheDocument();
  });

  it("honors a custom label", () => {
    render(<MathInput onInsert={() => undefined} label="Math" />);
    expect(screen.getByRole("button", { name: "Math" })).toBeInTheDocument();
  });
});
