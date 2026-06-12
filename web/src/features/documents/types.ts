/**
 * Hand-typed Documents contract. `routes/document_routes.py` is a frozen god-file (1687
 * lines), so — like tasks/calendar/models — these types are hand-maintained against the route
 * handlers and the documents endpoints are NOT in ui-contract-endpoints.txt.
 *
 * Note: there is no standalone image-analysis endpoint. Analysis of scanned/handwritten work
 * happens via PDF import (auto VL extraction on image-heavy pages) — see useImportPdf — or via
 * chat image attachments.
 */

/** A library list item (no full content — `preview` is the first 500 chars). */
export interface DocItem {
  id: string;
  title: string;
  language: string;
  preview: string;
  version_count: number;
  session_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LibraryResponse {
  documents: DocItem[];
  total: number;
  languages: Record<string, number>;
  session_count: number;
}

/** A full document (from GET /api/document/{id} or create/update). */
export interface DocFull {
  id: string;
  title: string;
  language: string | null;
  current_content: string;
  version_count: number;
  is_active: boolean;
  archived: boolean;
  session_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DocVersion {
  id: string;
  version_number: number;
  content: string;
  summary: string | null;
  source: "ai" | "user" | "ocr";
  created_at: string;
}

export interface DocCreateInput {
  title: string;
  content: string;
  language?: string;
}
