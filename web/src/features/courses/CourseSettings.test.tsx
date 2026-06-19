import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders, stubFetch, jsonResponse, findCall } from "../../test/util.tsx";
import { CourseSettings } from "./CourseSettings.tsx";
import type { Course } from "../../api/types.ts";

afterEach(() => vi.unstubAllGlobals());

function course(settings: Record<string, unknown>): Course {
  return { id: "c1", name: "Calc", status: "active", settings } as unknown as Course;
}

it("reflects current dial values, falling back to the calm defaults", () => {
  stubFetch([["/api/courses/c1", () => jsonResponse({})]]);
  renderWithProviders(<CourseSettings course={course({ scaffolding: "direct" })} />);
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  expect(selects[0].value).toBe("direct"); // scaffolding (set)
  expect(selects[1].value).toBe("gentle"); // pace (default)
  expect(selects[2].value).toBe("warm"); // tone (default)
});

it("saves a MERGED settings PATCH, preserving non-dial keys", async () => {
  const fetchMock = stubFetch([
    ["/api/courses/c1", () =>
      jsonResponse({ id: "c1", name: "Calc", status: "active", settings: {} })],
  ]);
  renderWithProviders(
    <CourseSettings course={course({ scaffolding: "direct", coupling_mutes: ["physics"] })} />,
  );
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  await userEvent.selectOptions(selects[2], "matter-of-fact"); // tone

  const call = findCall(fetchMock, "/api/courses/c1", "PATCH");
  expect(call).toBeTruthy();
  const body = (await (call![0] as Request).clone().json()) as {
    settings: Record<string, unknown>;
  };
  // the changed axis is added, the existing dial + non-dial keys are preserved
  expect(body.settings).toEqual({
    scaffolding: "direct",
    coupling_mutes: ["physics"],
    tone: "matter-of-fact",
  });
});
