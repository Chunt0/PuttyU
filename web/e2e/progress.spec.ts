import { test, expect, type Page } from "@playwright/test";

/**
 * Phase-2 T3b / F5 flow (ADR 0002 Gate 3): open a course → Progress → the
 * state-colored concept tree renders (4-state vocabulary, no percentages) →
 * click a concept → the trajectory shows the stated quote verbatim and the
 * invalidated insight struck through → challenge an insight (correction POSTed,
 * row flips to invalidated, correction lands as a stated quote) → override
 * "I know this". Backend fully mocked; the graph store is stateful in-run.
 */

type Assertion = {
  id: string; kind: string; relation: string; statement: string; quote: string | null;
  confidence: number | null; subject_type: string; object_type: string | null;
  object_id: string | null; object_name: string | null; valid_from: string;
  invalidated_at: string | null; invalidation_reason: string | null;
  episode_refs: unknown[];
};

const A_STATED: Assertion = {
  id: "a1", kind: "stated", relation: "states",
  statement: "I always mix up sampling error and bias",
  quote: "I always mix up sampling error and bias",
  confidence: null, subject_type: "user", object_type: "concept", object_id: "n2",
  object_name: "Sampling error", valid_from: "2026-06-08T10:00:00Z",
  invalidated_at: null, invalidation_reason: null, episode_refs: [],
};
const A_INFERRED: Assertion = {
  id: "a2", kind: "inferred", relation: "struggles_with",
  statement: "avoids word problems", quote: null, confidence: 0.55,
  subject_type: "user", object_type: "concept", object_id: "n2",
  object_name: "Sampling error", valid_from: "2026-05-20T10:00:00Z",
  invalidated_at: null, invalidation_reason: null, episode_refs: [],
};
const A_OLD: Assertion = {
  id: "a3", kind: "inferred", relation: "confuses",
  statement: "confuses standard deviation with standard error", quote: null, confidence: 0.8,
  subject_type: "user", object_type: "concept", object_id: "n2",
  object_name: "Sampling error", valid_from: "2026-05-02T10:00:00Z",
  invalidated_at: "2026-06-02T10:00:00Z", invalidation_reason: "contradicted",
  episode_refs: [],
};

async function mockBackend(
  page: Page,
  captured: { challengePost: string | null; overridePost: string | null },
) {
  let authed = false;
  const assertions: Assertion[] = [A_STATED, A_INFERRED, A_OLD];

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

  // General graph routes first; specifics registered last win.
  await page.route("**/api/graph/observations**", (r) =>
    r.fulfill({ json: { observations: [
      { ...A_STATED, id: "o1", quote: "I like ice cream", statement: "I like ice cream",
        object_type: null, object_id: null, object_name: null },
    ] } }));
  await page.route("**/api/graph/concepts**", (r) =>
    r.fulfill({ json: {
      course_id: "c1",
      concepts: [
        { id: "h1", name: "Ch 1 Sampling", state: "unknown", p_known: null, evidence_count: 0,
          children: [
            { id: "n1", name: "Populations", state: "learning", p_known: 0.42, evidence_count: 2, children: [] },
            { id: "n2", name: "Sampling error", state: "shaky", p_known: 0.31, evidence_count: 3, children: [] },
            { id: "n3", name: "Confidence intervals", state: "mastered", p_known: 0.93, evidence_count: 5, children: [] },
          ] },
      ],
    } }));
  await page.route("**/api/graph/concepts/n2", (r) =>
    r.fulfill({ json: {
      id: "n2", name: "Sampling error", heading_path: ["Ch 1 Sampling", "Sampling error"],
      state: "shaky", p_known: 0.31,
      evidence: [
        { id: "e1", signal: "correct", weight: 1, created_at: "2026-06-10T15:00:00Z",
          source: "gym", note: null, indirect: false, episode_ref: null },
      ],
      assertions,
    } }));
  await page.route("**/api/graph/concepts/n2/override", (r) => {
    captured.overridePost = r.request().postData();
    return r.fulfill({ json: { id: "n2", state: "mastered", p_known: 0.95, evidence_count: 4 } });
  });
  await page.route("**/api/graph/assertions/a2/challenge", (r) => {
    captured.challengePost = r.request().postData();
    const a2 = assertions.find((a) => a.id === "a2");
    if (a2) {
      a2.invalidated_at = "2026-06-12T09:00:00Z";
      a2.invalidation_reason = "challenged by user";
    }
    const correction: Assertion = {
      ...A_STATED, id: "a4", relation: "corrects",
      quote: "I just hadn't gotten to them yet",
      statement: "avoids word problems", valid_from: "2026-06-12T09:00:00Z",
    };
    assertions.push(correction);
    return r.fulfill({ json: { invalidated: a2, correction } });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("see the map, read a trajectory, challenge an insight, override mastery", async ({ page }) => {
  const captured = { challengePost: null as string | null, overridePost: null as string | null };
  await mockBackend(page, captured);
  await login(page);

  // Open the course, then the Progress tool.
  await page.getByRole("tab", { name: "AP Statistics" }).click();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const win = page.getByTestId("window-progress");

  // The state-colored tree: 4-state chips, evidence counts, never a percentage.
  await expect(win.getByRole("button", { name: "Populations" })).toBeVisible();
  await expect(win.locator(".state-chip--learning")).toHaveText("learning");
  await expect(win.locator(".state-chip--shaky")).toHaveText("shaky");
  await expect(win.locator(".state-chip--mastered")).toHaveText("mastered");
  await expect(win.getByText("3 evidence")).toBeVisible();
  expect(await win.textContent()).not.toContain("%");

  // Open a concept: the trajectory shows the verbatim stated quote and the
  // invalidated May insight struck through (visible, never hidden).
  await win.getByRole("button", { name: "Sampling error" }).click();
  await expect(win.getByText("I always mix up sampling error and bias")).toBeVisible();
  await expect(win.getByText(/correct — gym/)).toBeVisible();
  const oldRow = win.locator(".timeline-row--invalidated", {
    hasText: "confuses standard deviation with standard error",
  });
  await expect(oldRow).toBeVisible();
  await expect(oldRow).toContainText("invalidated");

  // Challenge the live insight: correction POSTed, row flips, correction lands stated.
  await win.getByRole("button", { name: "Challenge: avoids word problems" }).click();
  await win.getByLabel("Correction for: avoids word problems").fill("I just hadn't gotten to them yet");
  await win.getByRole("button", { name: "Send correction" }).click();
  await expect(win.getByText("I just hadn't gotten to them yet")).toBeVisible();
  expect(JSON.parse(captured.challengePost ?? "{}")).toEqual({
    correction: "I just hadn't gotten to them yet",
  });
  await expect(
    win.locator(".timeline-row--invalidated", { hasText: "avoids word problems" }),
  ).toBeVisible();

  // Override: "I know this" posts {known: true}.
  await win.getByRole("button", { name: "I know this" }).click();
  await expect.poll(() => captured.overridePost).not.toBeNull();
  expect(JSON.parse(captured.overridePost ?? "{}")).toEqual({ known: true });
});
