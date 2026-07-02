// Keyboard reference (fixed defaults in v1 — remappable keybinds are
// deliberately out of scope, docs/M0.3-FIDELITY.md).
const ROWS: [string, string][] = [
  ["Open the command palette", "Ctrl/⌘ K"],
  ["Focus the composer", "Ctrl /"],
  ["Toggle the sidebar", "Ctrl Alt B"],
  ["Slash commands", "/ in the composer"],
  ["Insert selected command", "Tab"],
  ["Close topmost window / overlay", "Esc"],
];

export function ShortcutsWindow() {
  return (
    <div className="kbd-rows">
      {ROWS.map(([label, keys]) => (
        <div className="kbd-row" key={label}>
          <span>{label}</span>
          <span className="keys">{keys}</span>
        </div>
      ))}
    </div>
  );
}
