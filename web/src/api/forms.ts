/**
 * forms.ts — typed POST for the backend's multipart-form endpoints (create session, etc.).
 *
 * openapi-fetch covers JSON endpoints; a few backend routes read `request.form()` instead.
 * `postForm` keeps those calls same-origin and lets the caller name the response type from
 * the generated schema, so the contract stays typed even off the openapi-fetch path.
 */
async function formRequest<T>(
  method: "POST" | "PATCH",
  path: string,
  fields: Record<string, string | undefined>,
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) form.set(k, v);
  }
  const res = await fetch(path, { method, body: form, credentials: "same-origin" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const postForm = <T>(path: string, fields: Record<string, string | undefined>) =>
  formRequest<T>("POST", path, fields);

/** PATCH with multipart fields — e.g. rename session (the backend reads Form params). */
export const patchForm = <T>(path: string, fields: Record<string, string | undefined>) =>
  formRequest<T>("PATCH", path, fields);

/** POST a pre-built multipart FormData body — for file uploads (caller names the type). */
export async function postFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// --- Hand-typed JSON helpers for endpoints not (yet) on the OpenAPI seam ---------------
// Same-origin; the caller names the response type (see features/models/types.ts).

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const getJson = <T>(path: string): Promise<T> => request<T>(path, { method: "GET" });

export const del = <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" });

export const postJson = <T>(path: string, body: unknown = {}): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const putJson = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const patchJson = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
