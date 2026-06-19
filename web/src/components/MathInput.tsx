import { useRef, useState, type KeyboardEvent } from "react";
import { Markdown } from "./Markdown.tsx";
import "./mathinput.css";

interface Props {
  /** Receives delimited block LaTeX (e.g. `$$x^2$$`) to splice into the answer text. */
  onInsert: (latex: string) => void;
  label?: string;
}

/**
 * MathInput — "the third input mode" (T5/F4): typed / drawn-captured / TYPED-MATH. An
 * idle button opens an inline panel with a LaTeX field + a LIVE preview rendered through
 * the SAME <Markdown> (one renderer for the preview and the transcript). Insert hands the
 * surface block-delimited `$$…$$` (never raw ASCII) — single-dollar inline math is off in
 * <Markdown>, so only `$$…$$` renders. The surface owns where it lands. Owns no answer state
 * — just the open/draft of one equation. Esc / Cancel / backdrop close, restoring focus to
 * the idle button (a11y).
 */
export function MathInput({ onInsert, label = "Insert equation" }: Props) {
  const [open, setOpen] = useState(false);
  const [latex, setLatex] = useState("");
  const openButtonRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setLatex("");
    // Return focus to the idle "Insert equation" button after it re-renders.
    requestAnimationFrame(() => openButtonRef.current?.focus());
  }

  function insert() {
    const trimmed = latex.trim();
    if (!trimmed) return;
    onInsert("$$" + trimmed + "$$");
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      insert();
    }
  }

  if (!open) {
    return (
      <span className="mathinput">
        <button
          ref={openButtonRef}
          type="button"
          className="mathinput-open"
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      </span>
    );
  }

  const draft = latex.trim();
  return (
    <div
      className="mathinput mathinput-panel"
      role="group"
      aria-label="Equation input"
      data-testid="mathinput"
    >
      <textarea
        className="mathinput-textarea"
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type LaTeX — e.g. x^2 + \frac{1}{2}"
        rows={2}
        aria-label="LaTeX equation"
        autoFocus
      />

      <span className="mathinput-preview-label">Preview</span>
      <div className="mathinput-preview" aria-live="polite" data-testid="mathinput-preview">
        {draft ? (
          <Markdown>{"$$" + draft + "$$"}</Markdown>
        ) : (
          <span className="mathinput-preview--empty">Your equation renders here.</span>
        )}
      </div>

      <div className="mathinput-actions">
        <button type="button" onClick={insert} disabled={!draft}>
          Insert
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
