/**
 * pdfStore.ts — which source PDF the viewer window is showing (F2 "open PDF at page").
 *
 * The window manager's tool registry is static, so the PdfViewer tool reads its target
 * from this store; `openPdf` is the single door every caller uses (library rows, TOC
 * nodes, citation chips) — it sets the target and raises the viewer window.
 */
import { create } from "zustand";
import { useWindowStore } from "../../app/windows/windowStore.ts";

export interface PdfTarget {
  sourceId: string;
  title: string;
  page: number | null;
}

interface PdfState {
  target: PdfTarget | null;
  setTarget: (t: PdfTarget | null) => void;
}

export const usePdfStore = create<PdfState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
}));

/** Open (or refocus) the PDF viewer window on `sourceId`, optionally at a page. */
export function openPdf(sourceId: string, title: string, page?: number | null): void {
  usePdfStore.getState().setTarget({ sourceId, title, page: page ?? null });
  useWindowStore.getState().open("pdf");
}
