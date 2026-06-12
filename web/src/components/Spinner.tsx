interface Props {
  label?: string;
}

/** Inline loading indicator: a small CSS ring + optional label. */
export function Spinner({ label }: Props) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}
