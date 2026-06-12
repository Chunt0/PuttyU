import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore, dockedWidth } from "./windowStore.ts";

beforeEach(() => {
  localStorage.clear();
  useWindowStore.setState({ windows: {}, nextZ: 1 });
});

const s = () => useWindowStore.getState();

describe("windowStore", () => {
  it("opens a window with default geometry and cascades the next one", () => {
    s().open("calendar");
    s().open("notes");
    const a = s().windows.calendar;
    const b = s().windows.notes;
    expect(a).toMatchObject({ minimized: false, dock: null });
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.z).toBeGreaterThan(a.z);
  });

  it("re-opening an open window focuses and un-minimizes it", () => {
    s().open("calendar");
    s().open("notes");
    s().minimize("calendar");
    s().open("calendar");
    expect(s().windows.calendar.minimized).toBe(false);
    expect(s().windows.calendar.z).toBeGreaterThan(s().windows.notes.z);
  });

  it("focus raises the window above the others", () => {
    s().open("calendar");
    s().open("notes");
    s().focus("calendar");
    expect(s().windows.calendar.z).toBeGreaterThan(s().windows.notes.z);
  });

  it("minimize hides; restore brings back on top", () => {
    s().open("calendar");
    s().minimize("calendar");
    expect(s().windows.calendar.minimized).toBe(true);
    s().restore("calendar");
    expect(s().windows.calendar.minimized).toBe(false);
  });

  it("persists geometry across close/reopen", () => {
    s().open("calendar");
    s().move("calendar", 300, 200);
    s().resize("calendar", 700, 500);
    s().close("calendar");
    expect(s().windows.calendar).toBeUndefined();
    s().open("calendar");
    expect(s().windows.calendar).toMatchObject({ x: 300, y: 200, w: 700, h: 500 });
  });

  it("clamps resize to the minimum size and move to the viewport origin", () => {
    s().open("calendar");
    s().resize("calendar", 10, 10);
    expect(s().windows.calendar.w).toBeGreaterThanOrEqual(320);
    expect(s().windows.calendar.h).toBeGreaterThanOrEqual(240);
    s().move("calendar", -50, -50);
    expect(s().windows.calendar.x).toBe(0);
    expect(s().windows.calendar.y).toBe(0);
  });

  it("docks and undocks, remembering the dock side across reopen", () => {
    s().open("calendar");
    s().setDock("calendar", "right");
    expect(s().windows.calendar.dock).toBe("right");
    s().close("calendar");
    s().open("calendar");
    expect(s().windows.calendar.dock).toBe("right");
    s().setDock("calendar", null);
    expect(s().windows.calendar.dock).toBeNull();
  });

  it("dockedWidth reports the widest visible panel per side", () => {
    s().open("calendar");
    s().open("notes");
    s().setDock("calendar", "right");
    s().resize("calendar", 400, 500);
    expect(dockedWidth(s().windows, "right")).toBe(400);
    expect(dockedWidth(s().windows, "left")).toBe(0);
    s().minimize("calendar");
    expect(dockedWidth(s().windows, "right")).toBe(0);
  });
});
