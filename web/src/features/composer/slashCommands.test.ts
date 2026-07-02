import { expect, test } from "bun:test";

import {
  COMMANDS,
  didYouMean,
  dispatch,
  levenshtein,
  matchCommands,
  scoreMatch,
  type SlashContext,
} from "./slashCommands";

function ctx(overrides: Partial<SlashContext> = {}) {
  const calls: string[] = [];
  const context: SlashContext = {
    navigate: (to) => calls.push(`nav:${to}`),
    setTheme: (key) => {
      calls.push(`theme:${key}`);
      return key !== "bogus";
    },
    openWindow: (id) => calls.push(`win:${id}`),
    notify: (msg) => calls.push(`notify:${msg}`),
    ...overrides,
  };
  return { context, calls };
}

test("prefix beats substring, token beats alias (Odysseus scoring)", () => {
  const theme = COMMANDS.find((c) => c.token === "/theme")!;
  const providers = COMMANDS.find((c) => c.token === "/providers")!;
  expect(scoreMatch(theme, "/theme")).toBe(1000);
  expect(scoreMatch(theme, "/th")).toBe(500);
  expect(scoreMatch(providers, "/settings")).toBe(900); // alias exact
  expect(scoreMatch(providers, "/sett")).toBe(400); // alias prefix
  expect(matchCommands("/th")[0].token).toBe("/theme");
});

test("popup matches only slash-leading input", () => {
  expect(matchCommands("hello /theme")).toEqual([]);
  expect(matchCommands("/help").length).toBeGreaterThan(0);
});

test("levenshtein distances", () => {
  expect(levenshtein("theme", "theme")).toBe(0);
  expect(levenshtein("theme", "thme")).toBe(1);
  expect(levenshtein("abc", "xyz")).toBe(3);
});

test("unknown command suggests the nearest token, never sends onward", () => {
  expect(didYouMean("/thme")).toBe("/theme");
  const { context, calls } = ctx();
  expect(dispatch("/thme midnight", context)).toBe(true);
  expect(calls[0]).toContain("did you mean /theme");
});

test("dispatch runs commands with args and aliases", () => {
  const { context, calls } = ctx();
  dispatch("/theme midnight", context);
  dispatch("/settings", context);
  dispatch("/theme", context);
  expect(calls).toEqual([
    "theme:midnight",
    "nav:/settings/providers",
    "win:theme",
  ]);
});

test("bad theme arg surfaces an error", () => {
  const { context, calls } = ctx();
  dispatch("/theme bogus", context);
  expect(calls.some((c) => c.startsWith("notify:Unknown theme"))).toBe(true);
});
