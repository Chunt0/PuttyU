import { describe, it, expect, beforeEach } from "vitest";
import { useCourseStore } from "./store.ts";

beforeEach(() => {
  localStorage.clear();
  useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
});

describe("useCourseStore", () => {
  it("persists the active course to localStorage", () => {
    useCourseStore.getState().setActiveCourse("c1");
    expect(useCourseStore.getState().activeCourseId).toBe("c1");
    expect(localStorage.getItem("puttyu-active-course")).toBe("c1");
  });

  it("clears the persisted course when going Home (null)", () => {
    useCourseStore.getState().setActiveCourse("c1");
    useCourseStore.getState().setActiveCourse(null);
    expect(useCourseStore.getState().activeCourseId).toBeNull();
    expect(localStorage.getItem("puttyu-active-course")).toBeNull();
  });

  it("skipOnboarding flips the per-load flag", () => {
    expect(useCourseStore.getState().onboardingSkipped).toBe(false);
    useCourseStore.getState().skipOnboarding();
    expect(useCourseStore.getState().onboardingSkipped).toBe(true);
  });
});
