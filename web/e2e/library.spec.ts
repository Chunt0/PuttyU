import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T2b / F2 flows (ADR 0002 Gate 3):
 *  1. browse the library → expand a TOC → a node click opens the PDF viewer window with
 *     the browser-native viewer iframe anchored at #page=N; an active course scopes the list;
 *  2. course materials: upload → tag → filter by tag → delete (two-step confirm).
 * Backend fully mocked; the sources store is stateful (upload/tags/delete persist in-run).
 */

type Src = {
  id: string; kind: string; title: string; source_type: string; subject: string | null;
  authors: string | null; status: string; course_id: string | null; tags: string[];
  has_pdf: boolean; chunk_count: number;
};

const S1: Src = { id: "s1", kind: "library", title: "Intro Stats", source_type: "textbook", subject: "statistics", authors: "OpenStax", status: "ready", course_id: null, tags: [], has_pdf: true, chunk_count: 120 };
const S2: Src = { id: "s2", kind: "library", title: "Physics Vol 1", source_type: "textbook", subject: "physics", authors: null, status: "ready", course_id: null, tags: [], has_pdf: true, chunk_count: 80 };

async function mockBackend(page: Page, captured: { materialPost: string | null }) {
  let authed = false;
  const sources: Src[] = [S1, S2];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));

  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));

  // General corpus routes first; specifics registered last win.
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources } }));
  await page.route("**/api/corpus/sources/s1/toc", (r) =>
    r.fulfill({
      json: {
        source_id: "s1",
        toc: [
          { heading: "Ch 2 Data", ordinal: 0, page_start: 70,
            children: [{ heading: "2.3 Two kinds of data", ordinal: 1, page_start: 87, children: [] }] },
        ],
      },
    }));
  await page.route("**/api/corpus/sources/*/pdf**", (r) =>
    r.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 fake" }));

  await page.route("**/api/corpus/materials**", (r) => {
    const m = r.request().method();
    if (m === "POST") {
      captured.materialPost = r.request().postData();
      const mat: Src = { id: "m1", kind: "material", title: "week-3 sheet", source_type: "material", subject: null, authors: null, status: "ready", course_id: "c1", tags: [], has_pdf: true, chunk_count: 3 };
      sources.push(mat);
      return r.fulfill({ json: { source: mat, created: true, chunks: 3, needs_ocr: false } });
    }
    if (m === "DELETE") {
      const i = sources.findIndex((s) => s.id === "m1");
      const [gone] = sources.splice(i, 1);
      return r.fulfill({ json: gone });
    }
    return r.fulfill({ json: { sources } });
  });
  await page.route("**/api/corpus/materials/*/tags", (r) => {
    const tags = JSON.parse(r.request().postData() ?? "{}").tags as string[];
    const mat = sources.find((s) => s.id === "m1");
    if (mat) mat.tags = tags;
    return r.fulfill({ json: { ...mat, tags } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("browse the library, expand the TOC, open the PDF at the cited page", async ({ page }) => {
  await mockBackend(page, { materialPost: null });
  await login(page);

  // Open the Library tool window — no active course: all sources show.
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const win = page.getByTestId("window-library");
  await expect(win.getByText("Intro Stats")).toBeVisible();
  await expect(win.getByText("Physics Vol 1")).toBeVisible();

  // Activate the course: the library scopes to its linked sources.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await expect(win.getByText(/Sources linked to AP Statistics/)).toBeVisible();
  await expect(win.getByText("Physics Vol 1")).toBeHidden();

  // Expand the TOC and open a section — the PDF viewer window opens at that page.
  await win.getByRole("button", { name: "Contents of Intro Stats" }).click();
  await win.getByRole("button", { name: /2\.3 Two kinds of data/ }).click();
  const pdfWin = page.getByTestId("window-pdf");
  await expect(pdfWin).toBeVisible();
  await expect(pdfWin.getByText("Intro Stats")).toBeVisible();
  await expect(pdfWin.getByText("p. 87")).toBeVisible();
  await expect(pdfWin.locator("iframe")).toHaveAttribute(
    "src",
    "/api/corpus/sources/s1/pdf#page=87",
  );
});

test("upload a course material, tag it, filter by tag, delete it", async ({ page }) => {
  const captured = { materialPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Work inside the Library window with the course active (upload carries course_id).
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const win = page.getByTestId("window-library");
  await expect(win.getByText("No materials yet.")).toBeVisible();

  // Upload a PDF.
  await win.getByLabel("Material files").setInputFiles({
    name: "week-3.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 sheet"),
  });
  await win.getByRole("button", { name: "Upload (1)" }).click();
  await expect(win.getByText("week-3 sheet")).toBeVisible();
  expect(captured.materialPost).toContain('name="course_id"');
  expect(captured.materialPost).toContain("c1");

  // Tag it.
  await win.getByLabel("Add tag to week-3 sheet").fill("homework");
  await win.getByLabel("Add tag to week-3 sheet").press("Enter");
  // The chip rendered (its remove button is unique to the chip, not the filter option).
  await expect(win.getByRole("button", { name: "Remove tag homework from week-3 sheet" })).toBeVisible();

  // Filter by the tag — the material stays visible under its tag.
  await win.getByLabel("Filter by tag").selectOption("homework");
  await expect(win.getByText("week-3 sheet")).toBeVisible();

  // Delete (two-step confirm) — it leaves the list.
  await win.getByRole("button", { name: "Delete week-3 sheet" }).click();
  await win.getByRole("button", { name: "Delete week-3 sheet" }).click();
  await expect(win.getByText("week-3 sheet")).toBeHidden();
});
