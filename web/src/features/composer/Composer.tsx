// The composer (docs/M0.3-FIDELITY.md §D): auto-growing textarea, Enter sends
// / Shift+Enter newline, slash autocomplete (popup only when input starts with
// "/" and has no newline; Tab always inserts; Enter inserts unless a full
// command was typed). Plain chat sends arrive with M0.4.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Icons } from "../../components/ui/icons";
import { registerEscape } from "../../app/escape";
import { useThemeStore } from "../../app/themeStore";
import { useToastStore } from "../../app/toasts";
import { useWindowStore } from "../../app/windows/windowStore";
import {
  dispatch,
  matchCommands,
  type SlashContext,
} from "./slashCommands";

export const COMPOSER_INPUT_ID = "composer-input";

export function Composer() {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(0);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const notify = useToastStore((s) => s.push);

  const ctx: SlashContext = useMemo(
    () => ({
      navigate: (to) => void navigate(to),
      setTheme: (key) => useThemeStore.getState().setTheme(key),
      openWindow: (id) => useWindowStore.getState().openWindow(id),
      notify,
    }),
    [navigate, notify],
  );

  // Popup only when the message starts with "/" and has no newline.
  const popupOpen =
    !popupDismissed && value.startsWith("/") && !value.includes("\n");
  const suggestions = popupOpen ? matchCommands(value) : [];

  useEffect(() => setSelected(0), [value]);
  useEffect(() => {
    if (!value.startsWith("/")) setPopupDismissed(false);
  }, [value]);

  // Auto-grow to 140px (kit Composer behavior).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [value]);

  // Escape hides the popup first (priority 300 — above palette and windows).
  const popupOpenRef = useRef(popupOpen);
  popupOpenRef.current = popupOpen && suggestions.length > 0;
  useEffect(
    () =>
      registerEscape({
        priority: 300,
        isActive: () => popupOpenRef.current,
        dismiss: () => setPopupDismissed(true),
      }),
    [],
  );

  const insertToken = (token: string) => {
    setValue(token + " ");
    textareaRef.current?.focus();
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      dispatch(text, ctx);
    } else {
      // The chat loop lands at M0.4 — be honest, never a dead button.
      notify("Chat arrives with M0.4 — try /help, or ⌘K to jump anywhere.");
    }
    setValue("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const showing = popupOpen && suggestions.length > 0;
    if (showing) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => (i + 1) % suggestions.length); // wrap
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Tab") {
        // Tab ALWAYS inserts the selected token.
        event.preventDefault();
        insertToken(suggestions[selected].token);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        // Enter inserts unless a full command (+ args/space) was typed.
        const typedFull = value.includes(" ");
        const exact = suggestions[selected].token === value.trim();
        if (!typedFull && !exact) {
          event.preventDefault();
          insertToken(suggestions[selected].token);
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  let lastCategory = "";
  return (
    <div className="composer-wrap">
      {popupOpen && suggestions.length > 0 ? (
        <div className="slash-ac" role="listbox" aria-label="Slash commands">
          {suggestions.map((command, index) => {
            const header =
              command.category !== lastCategory ? (
                <div className="slash-cat">{command.category}</div>
              ) : null;
            lastCategory = command.category;
            return (
              <div key={command.token}>
                {header}
                <div
                  role="option"
                  aria-selected={index === selected}
                  className={
                    "slash-item" + (index === selected ? " selected" : "")
                  }
                  onMouseDown={(e) => {
                    e.preventDefault(); // don't blur the textarea first
                    insertToken(command.token);
                  }}
                  onMouseEnter={() => setSelected(index)}
                >
                  <span className="tok">{command.usage ?? command.token}</span>
                  <span className="help">{command.help}</span>
                </div>
              </div>
            );
          })}
          <div className="slash-hint">Tab inserts · Enter runs · Esc hides</div>
        </div>
      ) : null}
      <div className="composer">
        <div className="composer-top">
          <textarea
            id={COMPOSER_INPUT_ID}
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder="Message puttyU — / for commands"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
          />
        </div>
        <div className="composer-bot">
          <button
            className="cib"
            title="Slash commands"
            onClick={() => {
              setValue("/");
              textareaRef.current?.focus();
            }}
          >
            <Icons.Shell size={15} />
          </button>
          <button
            className="send"
            aria-label="Send"
            disabled={value.trim() === ""}
            onClick={submit}
          >
            <Icons.Send />
          </button>
        </div>
      </div>
    </div>
  );
}
