import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Materials } from "./Materials.tsx";
import { renderWithProviders, jsonResponse, stubFetch, findCall, callInfo } from "../../test/util.tsx";

afterEach(() => vi.unstubAllGlobals());

const M1 = {
  id: "m1", kind: "material", title: "Course syllabus", source_type: "material", subject: null,
  authors: null, status: "ready", course_id: "c1", tags: ["syllabus"], has_pdf: true, chunk_count: 4,
};
const M2 = {
  id: "m2", kind: "material", title: "week-3 sheet", source_type: "material", subject: null,
  authors: null, status: "ready", course_id: "c1", tags: ["homework", "week-3"], has_pdf: true, chunk_count: 2,
};

function mockMaterials() {
  return stubFetch([
    ["/tags", () => jsonResponse(M2)],
    ["/api/corpus/materials", (_url, init) =>
      init?.method === "DELETE"
        ? jsonResponse(M1)
        : jsonResponse({ source: M1, created: true, chunks: 4, needs_ocr: false })],
    ["/api/corpus/sources", () => jsonResponse({ sources: [M1, M2] })],
  ]);
}

/** Read a recorded openapi-fetch call's JSON body (the mock gets a Request object). */
async function requestJson(call: unknown[]): Promise<unknown> {
  return (call[0] as Request).clone().json();
}

describe("Materials", () => {
  it("uploads picked files as one material with the course id", async () => {
    const fetchMock = mockMaterials();
    renderWithProviders(<Materials courseId="c1" />);
    await screen.findByText("Course syllabus");

    const a = new File(["a"], "page-1.png", { type: "image/png" });
    const b = new File(["b"], "page-2.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Material files"), [a, b]);
    await userEvent.click(screen.getByRole("button", { name: "Upload (2)" }));

    await waitFor(() => {
      const post = findCall(fetchMock, "/api/corpus/materials", "POST");
      expect(post).toBeTruthy();
      const body = callInfo(post!).body as FormData;
      expect(body.getAll("files")).toHaveLength(2); // both images → ONE material
      expect(body.get("course_id")).toBe("c1");
    });
  });

  it("adds a tag via PATCH with the full replacement list", async () => {
    const fetchMock = mockMaterials();
    renderWithProviders(<Materials courseId="c1" />);
    await screen.findByText("week-3 sheet");

    const input = screen.getByLabelText("Add tag to week-3 sheet");
    await userEvent.type(input, "physics{Enter}");

    let patch: unknown[] | undefined;
    await waitFor(() => {
      patch = findCall(fetchMock, "/api/corpus/materials/m2/tags", "PATCH");
      expect(patch).toBeTruthy();
    });
    expect(await requestJson(patch!)).toEqual({ tags: ["homework", "week-3", "physics"] });
  });

  it("removes a tag via PATCH without it", async () => {
    const fetchMock = mockMaterials();
    renderWithProviders(<Materials courseId="c1" />);
    await screen.findByText("week-3 sheet");

    await userEvent.click(screen.getByRole("button", { name: "Remove tag homework from week-3 sheet" }));
    let patch: unknown[] | undefined;
    await waitFor(() => {
      patch = findCall(fetchMock, "/api/corpus/materials/m2/tags", "PATCH");
      expect(patch).toBeTruthy();
    });
    expect(await requestJson(patch!)).toEqual({ tags: ["week-3"] });
  });

  it("filters the list by tag", async () => {
    mockMaterials();
    renderWithProviders(<Materials courseId="c1" />);
    await screen.findByText("Course syllabus");

    await userEvent.selectOptions(screen.getByLabelText("Filter by tag"), "week-3");
    expect(screen.queryByText("Course syllabus")).not.toBeInTheDocument();
    expect(screen.getByText("week-3 sheet")).toBeInTheDocument();
  });

  it("deletes a material after the two-step confirm", async () => {
    const fetchMock = mockMaterials();
    renderWithProviders(<Materials courseId="c1" />);
    await screen.findByText("Course syllabus");

    await userEvent.click(screen.getByRole("button", { name: "Delete Course syllabus" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Course syllabus" }));

    await waitFor(() => {
      expect(findCall(fetchMock, "/api/corpus/materials/m1", "DELETE")).toBeTruthy();
    });
  });
});
