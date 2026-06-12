import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";

/** Render a component with the providers it needs (no retries so failures surface fast). */
export function renderWithProviders(ui: ReactElement, initialEntries: string[] = ["/"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A Response whose body streams `text` as bytes — for SSE endpoints. */
export function sseResponse(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/**
 * Normalise a recorded fetch call. openapi-fetch passes a `Request` (method on the object);
 * raw fetch passes `(url, init)` (method on init). Returns a uniform view for assertions.
 */
export function callInfo(call: unknown[]): { url: string; method: string; body: unknown } {
  const [arg0, init] = call as [unknown, RequestInit | undefined];
  if (arg0 instanceof Request) {
    return { url: arg0.url, method: arg0.method.toUpperCase(), body: arg0.body };
  }
  return { url: String(arg0), method: (init?.method ?? "GET").toUpperCase(), body: init?.body };
}

/** Find a recorded fetch call by URL substring + HTTP method (Request- or init-shaped). */
export function findCall(
  mock: { mock: { calls: unknown[][] } },
  needle: string,
  method: string,
) {
  return mock.mock.calls.find((c) => {
    const info = callInfo(c);
    return info.url.includes(needle) && info.method === method.toUpperCase();
  });
}

/** Stub global fetch, routing by URL substring. Each handler gets (url, init). */
export function stubFetch(routes: Array<[string, (url: string, init?: RequestInit) => Response]>) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // openapi-fetch passes a Request object; raw fetch passes a string. Normalise.
    const u = url instanceof Request ? url.url : String(url);
    for (const [needle, handler] of routes) {
      if (u.includes(needle)) return handler(u, init);
    }
    throw new Error(`unrouted fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
