/** The 4-state mastery chip (§6 Q2): sentence-case word, state-colored via CSS
 * tokens — neutral lightness steps, with coral reserved for "shaky" (the one
 * state that wants the eye). Never a percentage. */
export function StateChip({ state }: { state: string }) {
  return <span className={`state-chip state-chip--${state}`}>{state}</span>;
}
