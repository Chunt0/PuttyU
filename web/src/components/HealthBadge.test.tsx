import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

import { HealthBadge } from "./HealthBadge";

afterEach(cleanup);

test("HealthBadge renders backend status from the typed client", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;

  render(<HealthBadge />);

  await waitFor(() =>
    expect(document.body.textContent).toContain("ok · v0.0.0"),
  );
});
