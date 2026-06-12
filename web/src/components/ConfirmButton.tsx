import { useEffect, useRef, useState } from "react";

interface Props {
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Two-step destructive button: first click arms it ("Sure?"), a second click within the
 * window confirms. Arming times out (or resets on blur) so a stray click can't destroy
 * data — the app-wide replacement for bare one-click deletes.
 */
export function ConfirmButton({
  onConfirm,
  label = "Delete",
  confirmLabel = "Sure?",
  className = "",
  title,
  disabled,
}: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onClick() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <button
      type="button"
      className={`${className} ${armed ? "confirm-armed" : ""}`.trim()}
      onClick={onClick}
      onBlur={() => setArmed(false)}
      title={title ?? label}
      aria-label={title ?? label}
      disabled={disabled}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
