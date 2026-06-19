import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T5 vertical-2 / F2 flow (ADR 0002 Gate 3): open the Library → "Mine schedule"
 * on a material → the read-only mine returns a normal item + an AMBIGUOUS item → the
 * ambiguous row shows its question and BLOCKS commit until resolved → resolve it → uncheck
 * one item → commit → the apply POST body carries the accepted items and NOT the unchecked
 * one. Confirm-first: nothing is written until the explicit commit (untrusted-content).
 * Backend fully mocked.
 */

type Src = {
  id: string; kind: string; title: string; source_type: string; subject: string | null;
  authors: string | null; status: string; course_id: string | null; tags: string[];
  has_pdf: boolean; chunk_count: number;
};

const MAT: Src = {
  id: "m1", kind: "material", title: "Stats syllabus", source_type: "material", subject: null,
  authors: null, status: "ready", course_id: null, tags: [], has_pdf: true, chunk_count: 12,
};

async function mockBackend(page: Page, captured: { applyPost: string | null }) {
  let authed = false;

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }));
  await page.route("**/api/auth/login", (r) => {
    authed = true;
    return r.fulfill({ json: { ok: true, username: "ada" } });
  });
  await page.route("**/api/sessions**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/default-chat", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/courses**", (r) => r.fulfill({ json: { courses: [] } }));

  // The Library reads the corpus + materials lists; ours has one mineable material.
  await page.route("**/api/corpus/sources**", (r) => r.fulfill({ json: { sources: [MAT] } }));
  await page.route("**/api/corpus/materials**", (r) => r.fulfill({ json: { sources: [MAT] } }));

  // mine: read-only — a normal homework todo + an ambiguous (no-date) exam.
  await page.route("**/api/schedule/m1/mine**", (r) =>
    r.fulfill({ json: {
      source_id: "m1",
      title: "Stats syllabus",
      summary: "Found 1 homework item, 1 exam — add to calendar and todos?",
      proposals: [
        {
          key: "k-hw1", kind: "todo", type: "homework", title: "Problem set 1",
          date: "2026-09-10", end_date: null, all_day: true, page: 2, ambiguous: false,
          question: null, status: "new", existing_id: null, citation: "[Stats syllabus, p. 2]",
        },
        {
          key: "k-final", kind: "event", type: "exam", title: "Final exam",
          date: null, end_date: null, all_day: true, page: 3, ambiguous: true,
          question: "couldn't resolve 'finals week' — when does it start?",
          status: "new", existing_id: null, citation: "[Stats syllabus, p. 3]",
        },
      ],
    } }));

  // apply: the only writer — capture the body to assert what was accepted.
  await page.route("**/api/schedule/m1/apply**", (r) => {
    captured.applyPost = r.request().postData();
    return r.fulfill({ json: { created_events: 1, created_todos: 0, updated: 0, skipped: 0 } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("mine a syllabus, resolve an ambiguous date, prune one, then commit", async ({ page }) => {
  const captured = { applyPost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Open the Library and mine the material's schedule.
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const lib = page.getByTestId("window-library");
  await expect(lib.getByText("Stats syllabus")).toBeVisible();
  await lib.getByRole("button", { name: "Mine schedule" }).click();

  // The miner window opens with the calm summary and both proposals.
  const win = page.getByTestId("window-miner");
  await expect(win.getByTestId("miner-summary")).toContainText("1 homework item, 1 exam");
  await expect(win.getByText("Problem set 1")).toBeVisible();
  await expect(win.getByText("Final exam")).toBeVisible();

  // The ambiguous row shows its question and its checkbox is disabled (ask-don't-guess).
  await expect(win.getByText(/couldn't resolve 'finals week'/)).toBeVisible();
  const ambiguousCheck = win.getByLabel("Include Final exam");
  await expect(ambiguousCheck).toBeDisabled();

  // Commit count reflects only the committable (resolved+checked) row: the homework.
  await expect(win.getByRole("button", { name: /Add to calendar \+ todos \(1\)/ })).toBeVisible();

  // Resolve the ambiguous exam by supplying a date — now it becomes committable.
  await win.getByLabel("Date for Final exam").fill("2026-12-14");
  await expect(ambiguousCheck).toBeEnabled();
  await expect(win.getByRole("button", { name: /Add to calendar \+ todos \(2\)/ })).toBeVisible();

  // Prune the homework (uncheck it) — back down to 1 committable (the resolved exam).
  await win.getByLabel("Include Problem set 1").uncheck();
  await expect(win.getByRole("button", { name: /Add to calendar \+ todos \(1\)/ })).toBeVisible();

  // Commit (two-step confirm — the ConfirmButton's accessible name is stable; its visible
  // text flips to the confirm label when armed). The miner closes on success.
  const commit = win.getByRole("button", { name: /Add to calendar \+ todos/ });
  await commit.click(); // arm
  await expect(commit).toHaveText("Confirm — add now");
  await commit.click(); // confirm
  await expect(page.getByTestId("window-miner")).toBeHidden();

  // The apply body carried ONLY the accepted, resolved exam — not the pruned homework.
  const body = JSON.parse(captured.applyPost ?? "{}");
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items).toHaveLength(1);
  expect(body.items[0].key).toBe("k-final");
  expect(body.items[0].kind).toBe("event");
  expect(body.items[0].date).toBe("2026-12-14");
  expect(body.items[0].accepted).toBe(true);
  // The pruned homework is absent.
  expect(body.items.some((i: { key: string }) => i.key === "k-hw1")).toBe(false);
});
