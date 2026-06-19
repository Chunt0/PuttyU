import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T6a / F4 flow (ADR 0002 Gate 3): open a course → Worksheet → upload a photo
 * of handwritten work → "check my work" → each problem comes back with what's right,
 * where the FIRST error is, a nudge question (guide mode), and the mistaken section as a
 * clickable citation door. The POST carries {course_id, attachment_ids, guide}. Backend
 * fully mocked.
 */

async function mockBackend(page: Page, captured: { gradePost: string | null }) {
  let authed = false;

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });
  await page.route("**/api/sessions**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) =>
    r.fulfill({ json: { courses: [{ id: "c1", name: "AP Statistics", status: "active", settings: {} }] } }));
  await page.route("**/api/courses/*/sources", (r) =>
    r.fulfill({ json: { course_id: "c1", source_ids: ["s1"] } }));
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/corpus/materials**", (r) => r.fulfill({ json: { sources: [] } }));

  // Upload: a single image returns one upload id.
  await page.route("**/api/upload", (r) =>
    r.fulfill({ json: { files: [{ id: "f1", name: "worksheet.png", mime: "image/png", size: 10 }] } }));

  // Grade: capture the body, return two per-problem verdicts (one with a citation door).
  await page.route("**/api/practice/worksheet", (r) => {
    captured.gradePost = r.request().postData();
    return r.fulfill({ json: {
      concepts_touched: ["Sampling error", "Confidence intervals"],
      problems: [
        {
          problem_label: "Problem 1",
          verdict: "correct",
          whats_right: "You set up the sampling distribution correctly.",
          first_error: "",
          nudge_question: "",
          concept_id: "n1", concept_name: "Sampling error", state: "learning", effective_p: 0.55,
          study_citation: {
            chunk_id: "ch1", source_id: "s1", title: "Intro Stats",
            heading: "Ch 1 > 1.2 Sampling", page_start: 14,
            citation: "[Intro Stats §1.2 Sampling, p. 14]",
          },
        },
        {
          problem_label: "Problem 2",
          verdict: "incorrect",
          whats_right: "Good — you used the t-distribution.",
          first_error: "The standard error uses n, not n minus 1, in the denominator here.",
          nudge_question: "Which n belongs under the square root for a sample mean?",
          concept_id: "n2", concept_name: "Confidence intervals", state: "shaky", effective_p: 0.3,
        },
      ],
    } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("check a worksheet: upload, grade, see per-problem feedback and a citation door", async ({ page }) => {
  const captured = { gradePost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Into the course, open the Worksheet tool window.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Worksheet", exact: true }).click();
  const win = page.getByTestId("window-worksheet");

  // "Check my work" is disabled until a page is attached.
  await expect(win.getByRole("button", { name: "Check my work" })).toBeDisabled();

  // Upload a photo via the hidden file input → a chip appears.
  await win.getByLabel("Upload photos").setInputFiles({
    name: "worksheet.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-png-bytes"),
  });
  await expect(win.getByText("worksheet.png")).toBeVisible();

  // Check the work.
  await win.getByRole("button", { name: "Check my work" }).click();

  // Two per-problem cards render with the calm verdict words.
  await expect(win.getByTestId("worksheet-problem")).toHaveCount(2);
  await expect(win.getByText("Correct", { exact: true })).toBeVisible();
  await expect(win.getByText("Not yet", { exact: true })).toBeVisible();

  // Problem 1: what's right + the study citation as a door.
  await expect(win.getByText("You set up the sampling distribution correctly.")).toBeVisible();
  await expect(win.getByTestId("citations").first()).toBeVisible();
  await expect(win.getByRole("button", { name: "Intro Stats §1.2 Sampling · p. 14" })).toBeVisible();

  // Problem 2: the FIRST error + the guide-mode nudge.
  await expect(
    win.getByText("The standard error uses n, not n minus 1, in the denominator here."),
  ).toBeVisible();
  await expect(win.getByText("Which n belongs under the square root for a sample mean?")).toBeVisible();

  // The POST carried {course_id, attachment_ids, guide} (guide defaults ON).
  const body = JSON.parse(captured.gradePost ?? "{}");
  expect(body.course_id).toBe("c1");
  expect(body.attachment_ids).toEqual(["f1"]);
  expect(body.guide).toBe(true);
});
