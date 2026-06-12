interface PlaceholderProps {
  title: string;
  slice: string;
}

/** Stand-in for a screen not yet built; names the slice that will deliver it. */
export function Placeholder({ title, slice }: PlaceholderProps) {
  return (
    <section className="placeholder">
      <h1>{title}</h1>
      <p>This screen lands in {slice}.</p>
    </section>
  );
}
