// The single Escape arbiter (docs/M0.3-FIDELITY.md §G, from Odysseus ui.js):
// exactly ONE thing closes per press, by priority — no per-component Escape
// handlers cascading. Capture phase + stopImmediatePropagation.
//
// Priorities: slash popup 300 > palette 200 > topmost tool window 100.

export interface EscapeEntry {
  priority: number;
  isActive: () => boolean;
  dismiss: () => void;
}

const entries = new Set<EscapeEntry>();
let installed = false;

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const active = [...entries]
    .filter((e) => e.isActive())
    .sort((a, b) => b.priority - a.priority);
  const top = active[0];
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.dismiss();
}

export function installEscapeArbiter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeydown, true);
}

export function registerEscape(entry: EscapeEntry): () => void {
  installEscapeArbiter();
  entries.add(entry);
  return () => {
    entries.delete(entry);
  };
}
