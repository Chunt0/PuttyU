/** Chat attachments — upload files to /api/upload, then send their ids with the turn
 * (chat_stream reads `attachments` as a JSON array of upload ids). The backend runs
 * image/document analysis on them (handwritten-work photos included). */
import { postFormData } from "../../api/forms.ts";

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

interface UploadResponse {
  files: UploadedFile[];
}

export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await postFormData<UploadResponse>("/api/upload", form);
  return res.files;
}

export const isImage = (f: UploadedFile) => f.mime.startsWith("image/");

/** Thumbnail URL for an uploaded image (same-origin, auth via cookie). */
export const thumbUrl = (f: UploadedFile) => `/api/upload/${encodeURIComponent(f.id)}?thumb=1`;
