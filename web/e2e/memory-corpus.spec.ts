import { test, expect, type Page } from "@playwright/test";

/**
 * Slice-3 flow (ADR 0002 Gate 3): login -> Memory (add a fact, see it listed) ->
 * Corpus (see the active embedding model + an indexed document). The backend is mocked at
 * the network boundary; the memory store is stateful so an added memory persists into the
 * refetched list (mirroring the real save → invalidate → reload cycle).
 */

type Mem = { id: string; text: string; category: string; source: string; timestamp: number; uses: number; owner: string | null };

async function mockBackend(page: Page) {
  let authed = false;
  const memories: Mem[] = [
    { id: "m1", text: "User is studying statistics", category: "identity", source: "user", timestamp: 1, uses: 0, owner: null },
  ];

  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { authenticated: authed, username: authed ? "ada" : null, is_admin: true } }),
  );
  await page.route("**/api/auth/login", (r) => { authed = true; return r.fulfill({ json: { ok: true, username: "ada" } }); });
  await page.route("**/api/sessions", (r) => r.fulfill({ json: [] }));

  // All /api/memory traffic through one stateful handler (avoids route-precedence surprises).
  await page.route(/\/api\/memory(\/|\?|$)/, (r) => {
    const url = r.request().url();
    if (url.includes("/memory/add")) {
      const body = JSON.parse(r.request().postData() ?? "{}");
      memories.push({ id: `m${memories.length + 1}`, text: body.text, category: body.category, source: "user", timestamp: Date.now(), uses: 0, owner: null });
      return r.fulfill({ json: { ok: true, count: memories.length } });
    }
    if (url.includes("/memory/search")) {
      return r.fulfill({ json: { memories, total: memories.length, query: "" } });
    }
    if (r.request().method() === "DELETE") {
      return r.fulfill({ json: { ok: true, message: "deleted" } });
    }
    return r.fulfill({ json: { memory: memories } });
  });

  await page.route("**/api/personal", (r) =>
    r.fulfill({ json: { files: [{ name: "stats-ch1.pdf", size: 204800, path: "/data/personal_uploads/local/stats-ch1.pdf" }], directories: [] } }),
  );
  await page.route("**/api/embeddings/endpoint", (r) => r.fulfill({ json: { url: "", model: "", active: false } }));
  await page.route("**/api/embeddings/models", (r) => r.fulfill({ json: [{ model: "BAAI/bge-small-en-v1.5", active: true, downloaded: true }] }));
}

test("add a memory and view the corpus", async ({ page }) => {
  await mockBackend(page);

  await page.goto("/");
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Memory: the seeded fact is listed; add a new one and watch it appear.
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByText("User is studying statistics")).toBeVisible();
  await page.getByLabel("Memory text").fill("User lives in Berlin");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("User lives in Berlin")).toBeVisible();

  // Corpus: the active embedding model and the indexed document are shown.
  await page.getByRole("button", { name: "Corpus", exact: true }).click();
  await expect(page.getByText(/bge-small-en-v1\.5 \(built-in\)/)).toBeVisible();
  await expect(page.getByText("stats-ch1.pdf")).toBeVisible();
  await expect(page.getByText("Indexed documents (1)")).toBeVisible();
});
