import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CourseTabs } from "./CourseTabs.tsx";
import { CourseLanding } from "./CourseLanding.tsx";
import { Home } from "./Home.tsx";
import { useCourseStore } from "./store.ts";
import { useUiStore } from "../../lib/store.ts";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";
import type { Course } from "../../api/types.ts";

beforeEach(() => {
  localStorage.clear();
  useCourseStore.setState({ activeCourseId: null, onboardingSkipped: false });
  useUiStore.setState({ currentSessionId: null });
});
afterEach(() => vi.unstubAllGlobals());

const stats: Course = { id: "c1", name: "AP Statistics", status: "active", settings: {} };
const lit: Course = { id: "c2", name: "Victorian Lit", status: "archived", settings: {} };

describe("CourseTabs", () => {
  it("renders Home plus a tab per ACTIVE course and activates on click", async () => {
    stubFetch([["/api/courses", () => jsonResponse({ courses: [stats, lit] })]]);
    renderWithProviders(<CourseTabs />);

    expect(await screen.findByRole("tab", { name: "AP Statistics" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Victorian Lit" })).not.toBeInTheDocument();

    useUiStore.setState({ currentSessionId: "s9" });
    await userEvent.click(screen.getByRole("tab", { name: "AP Statistics" }));
    expect(useCourseStore.getState().activeCourseId).toBe("c1");
    // Entering a course clears the chat selection so its landing pane shows.
    expect(useUiStore.getState().currentSessionId).toBeNull();
  });

  it("archives a course via the two-step confirm and falls back to Home", async () => {
    useCourseStore.setState({ activeCourseId: "c1" });
    const fetchMock = stubFetch([
      ["/api/courses/c1/archive", () => jsonResponse({ ...stats, status: "archived" })],
      ["/api/courses", () => jsonResponse({ courses: [stats] })],
    ]);
    renderWithProviders(<CourseTabs />);
    await screen.findByRole("tab", { name: "AP Statistics" });

    const btn = screen.getByRole("button", { name: "Archive AP Statistics" });
    await userEvent.click(btn); // arm
    expect(findCall(fetchMock, "/api/courses/c1/archive", "POST")).toBeFalsy();
    await userEvent.click(btn); // confirm

    await waitFor(() => expect(findCall(fetchMock, "/api/courses/c1/archive", "POST")).toBeTruthy());
    expect(useCourseStore.getState().activeCourseId).toBeNull();
  });

  it("creates a course from the + menu and unarchives from manage courses", async () => {
    // Stateful: the refetch after create must include the new course, or the
    // tabs' stale-course guard would bounce the selection back to Home.
    const all: Course[] = [lit];
    const fetchMock = stubFetch([
      ["/api/courses/c2/unarchive", () => jsonResponse({ ...lit, status: "active" })],
      ["/api/courses", (_url, init) => {
        if (init?.method === "POST") {
          const created: Course = { id: "c3", name: "Mandarin 2", status: "active", settings: {} };
          all.push(created);
          return jsonResponse(created);
        }
        return jsonResponse({ courses: all });
      }],
    ]);
    renderWithProviders(<CourseTabs />);

    await userEvent.click(await screen.findByRole("button", { name: "Add course" }));
    // Manage view lists the archived course with an unarchive action.
    expect(await screen.findByText("Victorian Lit")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    await waitFor(() => expect(findCall(fetchMock, "/api/courses/c2/unarchive", "POST")).toBeTruthy());

    await userEvent.type(screen.getByLabelText("New course name"), "Mandarin 2");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      const call = findCall(fetchMock, "/api/courses", "POST");
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(useCourseStore.getState().activeCourseId).toBe("c3"));
  });
});

describe("Home / onboarding", () => {
  it("shows the welcome step when there are no courses, and creates one", async () => {
    const fetchMock = stubFetch([
      ["/api/courses", (_url, init) =>
        init?.method === "POST"
          ? jsonResponse({ id: "c9", name: "Calculus 1", status: "active", settings: {} })
          : jsonResponse({ courses: [] }),
      ],
    ]);
    renderWithProviders(<Home />);

    expect(await screen.findByText("What are you studying right now?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Course name"), "Calculus 1");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    await waitFor(() => {
      const call = findCall(fetchMock, "/api/courses", "POST");
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(useCourseStore.getState().activeCourseId).toBe("c9"));
  });

  it("is skippable to Home (chat)", async () => {
    stubFetch([
      ["/api/courses", () => jsonResponse({ courses: [] })],
      ["/api/history", () => jsonResponse({ history: [], model: "m", name: "chat" })],
      ["/api/sessions", () => jsonResponse([])],
    ]);
    renderWithProviders(<Home />);

    await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(useCourseStore.getState().onboardingSkipped).toBe(true);
    expect(screen.queryByText("What are you studying right now?")).not.toBeInTheDocument();
  });
});

describe("CourseLanding", () => {
  it("is honest about empty library coverage and lists the course's chats", async () => {
    stubFetch([
      ["/api/courses/c1/sources", () => jsonResponse({ course_id: "c1", source_ids: [] })],
      ["/api/sessions", (url) => {
        expect(url).toContain("course_id=c1");
        return jsonResponse([{ id: "s1", name: "Sampling distributions", model: "m" }]);
      }],
    ]);
    renderWithProviders(<CourseLanding course={stats} />);

    expect(await screen.findByText(/No library sources linked/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sampling distributions" })).toBeInTheDocument();
  });

  it("starts a new chat bound to the course", async () => {
    useCourseStore.setState({ activeCourseId: "c1" });
    const fetchMock = stubFetch([
      ["/api/courses/c1/sources", () => jsonResponse({ course_id: "c1", source_ids: ["src-1"] })],
      ["/api/sessions", () => jsonResponse([])],
      ["/api/default-chat", () => jsonResponse({})],
      ["/api/session", () => jsonResponse({ id: "s2", name: "New chat", model: "", course_id: "c1" })],
    ]);
    renderWithProviders(<CourseLanding course={stats} />);
    // Linked sources -> no warning chip.
    await screen.findByText("No chats in this course yet.");
    expect(screen.queryByText(/No library sources linked/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    await waitFor(() => {
      const call = findCall(fetchMock, "/api/session", "POST");
      expect(call).toBeTruthy();
      expect((callInfo(call!).body as FormData).get("course_id")).toBe("c1");
    });
    expect(useUiStore.getState().currentSessionId).toBe("s2");
  });
});
