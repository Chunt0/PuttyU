import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ScheduleProposal } from "../../api/types.ts";
import {
  defaultChecked,
  fallbackSummary,
  isCommittable,
  isResolved,
  toApplyItem,
  type RowEdit,
} from "./miner.model.ts";
import { Miner } from "./Miner.tsx";
import { useMinerStore } from "./minerStore.ts";
import { useWindowStore } from "../../app/windows/windowStore.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall } from "../../test/util.tsx";

function prop(partial: Partial<ScheduleProposal>): ScheduleProposal {
  return {
    key: "k1",
    kind: "todo",
    type: "homework",
    title: "Problem set 1",
    date: "2026-09-10",
    all_day: true,
    page: 2,
    ambiguous: false,
    question: null,
    status: "new",
    ...partial,
  };
}

function edit(partial: Partial<RowEdit> = {}): RowEdit {
  return { checked: true, title: "Problem set 1", date: "2026-09-10", allDay: true, ...partial };
}

describe("defaultChecked", () => {
  it("includes new and changed, prunes unchanged and stale", () => {
    expect(defaultChecked("new")).toBe(true);
    expect(defaultChecked("changed")).toBe(true);
    expect(defaultChecked("unchanged")).toBe(false);
    expect(defaultChecked("stale")).toBe(false);
  });
});

describe("isResolved / isCommittable — the ask-don't-guess gate", () => {
  it("non-ambiguous rows are always resolved", () => {
    expect(isResolved(prop({ ambiguous: false }), edit({ date: "" }))).toBe(true);
  });

  it("an ambiguous row is unresolved until a date is supplied", () => {
    const p = prop({ ambiguous: true, date: null, question: "when is week 5?" });
    expect(isResolved(p, edit({ date: "" }))).toBe(false);
    expect(isResolved(p, edit({ date: "2026-10-01" }))).toBe(true);
  });

  it("an ambiguous-unresolved row can never be committed, even if checked", () => {
    const p = prop({ ambiguous: true, date: null });
    expect(isCommittable(p, edit({ checked: true, date: "" }))).toBe(false);
    expect(isCommittable(p, edit({ checked: true, date: "2026-10-01" }))).toBe(true);
  });

  it("an unchecked row is never committable", () => {
    expect(isCommittable(prop({}), edit({ checked: false }))).toBe(false);
  });
});

describe("fallbackSummary", () => {
  it("returns '' for no proposals", () => {
    expect(fallbackSummary([])).toBe("");
  });

  it("counts by type, pluralizes, and orders by frequency", () => {
    const ps = [
      prop({ key: "a", type: "homework" }),
      prop({ key: "b", type: "homework" }),
      prop({ key: "c", type: "homework" }),
      prop({ key: "d", type: "exam", kind: "event" }),
    ];
    expect(fallbackSummary(ps)).toBe("Found 3 homework items, 1 exam — add to calendar and todos?");
  });

  it("falls back to kind when type is empty (singular for one)", () => {
    const ps = [prop({ key: "a", type: "", kind: "event" })];
    expect(fallbackSummary(ps)).toBe("Found 1 event — add to calendar and todos?");
  });

  it("pluralizes an unknown type naively for more than one", () => {
    const ps = [prop({ key: "a", type: "", kind: "event" }), prop({ key: "b", type: "", kind: "event" })];
    expect(fallbackSummary(ps)).toBe("Found 2 events — add to calendar and todos?");
  });
});

describe("toApplyItem", () => {
  it("maps a confirmed, edited proposal carrying key/kind/edits/page/existing_id", () => {
    const p = prop({ key: "k9", kind: "event", page: 4, existing_id: "ev-1", end_date: "2026-09-11" });
    const item = toApplyItem(p, edit({ title: "Midterm (moved)", date: "2026-10-19", allDay: true }));
    expect(item).toEqual({
      accepted: true,
      key: "k9",
      kind: "event",
      title: "Midterm (moved)",
      date: "2026-10-19",
      all_day: true,
      end_date: "2026-09-11",
      page: 4,
      existing_id: "ev-1",
    });
  });

  it("falls back to the proposal title/date when the edit is empty, and omits absent fields", () => {
    const p = prop({ key: "k2", page: null, existing_id: null, end_date: null });
    const item = toApplyItem(p, edit({ title: "  ", date: "" }));
    expect(item.title).toBe("Problem set 1");
    expect(item.date).toBe("2026-09-10");
    expect(item.page).toBeUndefined();
    expect(item.existing_id).toBeUndefined();
    expect(item.end_date).toBeUndefined();
  });
});

// --------------------------------------------------------------------------- #
// F4 — minimize unmounts the Miner window; restoring remounts it. A per-source
// cache (in minerStore) must make the remount RESTORE the prior mine result +
// edits instead of re-mining (a wasted LLM call) and resetting the user's work.
// --------------------------------------------------------------------------- #
const MINE_RESULT = {
  source_id: "src-1",
  title: "Stats 101 syllabus",
  summary: "Found 1 homework item — add to calendar and todos?",
  proposals: [
    {
      key: "p1", kind: "todo", type: "homework", title: "Problem set 1",
      date: "2026-09-10", all_day: true, page: 2, ambiguous: false,
      question: null, status: "new", existing_id: null, citation: "syllabus p. 2",
    },
  ],
};

function resetStores() {
  // Subscription-driven close detection keys off the "miner" window existing,
  // so reset both stores to a clean slate between tests.
  useMinerStore.setState({ target: null, cache: {} });
  useWindowStore.setState({ windows: {}, nextZ: 1 });
}

describe("Miner — F4 cache survives minimize/restore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStores();
  });

  it("mines once: a remount for the same source restores the cache, no re-mine", async () => {
    const fetchMock = stubFetch([
      ["/api/schedule/src-1/mine", () => jsonResponse(MINE_RESULT)],
    ]);
    // openMiner sets the target AND opens the (hidden) miner window.
    useMinerStore.getState().openMiner("src-1", "Stats 101 syllabus");

    const first = renderWithProviders(<Miner />);
    await screen.findByText("Problem set 1");
    expect(findCall(fetchMock, "/api/schedule/src-1/mine", "POST")).toBeTruthy();
    const minesAfterFirst = fetchMock.mock.calls.length;

    // Edit the row's title (local-only edit), then simulate MINIMIZE (the window
    // stays in the store; WindowLayer just unmounts the node).
    await userEvent.click(screen.getByRole("button", { name: "Edit Problem set 1" }));
    const titleInput = screen.getByLabelText("Title for Problem set 1");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "PS 1 (edited)");
    first.unmount();

    // Restore → remount. Must NOT re-mine, and must restore the edited title
    // (shown in the row's title span; the inline editor starts collapsed).
    renderWithProviders(<Miner />);
    await screen.findByText("PS 1 (edited)");
    expect(fetchMock.mock.calls.length).toBe(minesAfterFirst); // mined ONCE total
  });

  it("closing the miner window clears the cache (next open mines fresh)", async () => {
    const fetchMock = stubFetch([
      ["/api/schedule/src-1/mine", () => jsonResponse(MINE_RESULT)],
    ]);
    useMinerStore.getState().openMiner("src-1", "Stats 101 syllabus");
    const view = renderWithProviders(<Miner />);
    await screen.findByText("Problem set 1");
    expect(useMinerStore.getState().cache["src-1"]).toBeTruthy();

    view.unmount();
    // CLOSE removes the window → the subscription clears target + cache.
    useWindowStore.getState().close("miner");
    await waitFor(() => expect(useMinerStore.getState().cache["src-1"]).toBeUndefined());
    expect(useMinerStore.getState().target).toBeNull();
    void fetchMock;
  });
});
