// Slash-command registry + matcher (docs/M0.3-FIDELITY.md §D, behaviors from
// Odysseus slashCommands/slashAutocomplete): prefix beats substring, unknown
// commands get a Levenshtein "did you mean", never silently sent onward.
// Session commands (/new, /rename, /archive) arrive with M0.4.

import { THEME_KEYS } from "../../app/themes";

export interface SlashContext {
  navigate: (to: string) => void;
  setTheme: (key: string) => boolean;
  openWindow: (id: "theme" | "shortcuts") => void;
  notify: (message: string) => void;
}

export interface SlashCommand {
  token: string; // "/theme"
  category: string;
  help: string;
  usage?: string;
  aliases?: string[];
  run: (args: string[], ctx: SlashContext) => void;
}

export const COMMANDS: SlashCommand[] = [
  {
    token: "/theme",
    category: "Appearance",
    help: "Switch theme (no arg opens the picker)",
    usage: `/theme <${THEME_KEYS.slice(0, 3).join("|")}|…>`,
    run: (args, ctx) => {
      if (!args[0]) {
        ctx.openWindow("theme");
        return;
      }
      if (!ctx.setTheme(args[0])) {
        ctx.notify(`Unknown theme "${args[0]}" — /theme opens the picker.`);
      }
    },
  },
  {
    token: "/home",
    category: "Navigate",
    help: "Go home",
    run: (_args, ctx) => ctx.navigate("/"),
  },
  {
    token: "/providers",
    category: "Navigate",
    help: "Open the Providers screen",
    aliases: ["/settings"],
    run: (_args, ctx) => ctx.navigate("/settings/providers"),
  },
  {
    token: "/shortcuts",
    category: "Help",
    help: "Keyboard shortcuts",
    aliases: ["/keys"],
    run: (_args, ctx) => ctx.openWindow("shortcuts"),
  },
  {
    token: "/help",
    category: "Help",
    help: "List available commands",
    run: (_args, ctx) =>
      ctx.notify(
        "Commands: " +
          COMMANDS.map((c) => c.token).join("  ") +
          " — sessions & chat arrive with M0.4.",
      ),
  },
];

/** Odysseus _scoreMatch: exact token 1000 > alias exact 900 > token prefix 500
 * > alias prefix 400 > substring 100 > help-text substring 25. */
export function scoreMatch(command: SlashCommand, query: string): number {
  const q = query.toLowerCase();
  const token = command.token.toLowerCase();
  if (token === q) return 1000;
  const aliases = (command.aliases ?? []).map((a) => a.toLowerCase());
  if (aliases.includes(q)) return 900;
  if (token.startsWith(q)) return 500;
  if (aliases.some((a) => a.startsWith(q))) return 400;
  if (token.includes(q.replace(/^\//, ""))) return 100;
  if (command.help.toLowerCase().includes(q.replace(/^\//, ""))) return 25;
  return 0;
}

/** Commands matching the current input's first word, best score first. */
export function matchCommands(input: string): SlashCommand[] {
  const first = input.trimStart().split(/\s+/)[0] ?? "";
  if (!first.startsWith("/")) return [];
  return COMMANDS.map((c) => [scoreMatch(c, first), c] as const)
    .filter(([score]) => score > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, c]) => c);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n];
}

/** Closest command within 2 edits (Odysseus "did you mean …?"). */
export function didYouMean(token: string): string | null {
  let best: { token: string; d: number } | null = null;
  for (const c of COMMANDS) {
    const d = levenshtein(token.toLowerCase(), c.token.toLowerCase());
    if (d <= 2 && (best === null || d < best.d)) best = { token: c.token, d };
  }
  return best?.token ?? null;
}

/** Execute a submitted "/command args…". Returns true when handled. */
export function dispatch(input: string, ctx: SlashContext): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;
  const [token = "", ...args] = trimmed.split(/\s+/);
  const command = COMMANDS.find(
    (c) =>
      c.token.toLowerCase() === token.toLowerCase() ||
      (c.aliases ?? []).some((a) => a.toLowerCase() === token.toLowerCase()),
  );
  if (command) {
    command.run(args, ctx);
    return true;
  }
  const suggestion = didYouMean(token);
  ctx.notify(
    suggestion
      ? `Unknown command ${token} — did you mean ${suggestion}?`
      : `Unknown command ${token} — /help lists commands.`,
  );
  return true; // handled: never silently sent onward
}
