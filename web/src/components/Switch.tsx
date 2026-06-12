interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Accessible name when it should differ from the visible label (e.g. "Agent mode"). */
  ariaLabel?: string;
}

/**
 * Toggle switch — a styled track/knob over a real checkbox, so tests and
 * assistive tech still see a checkbox (`getByLabel(...).check()` keeps working).
 */
export function Switch({ checked, onChange, label, ariaLabel }: Props) {
  return (
    <label className="switch">
      <span className="switch-track">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel ?? label}
        />
      </span>
      {label}
    </label>
  );
}
