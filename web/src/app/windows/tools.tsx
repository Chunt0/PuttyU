import type { ReactNode } from "react";
import { Providers } from "../../features/models/Providers.tsx";
import { Memory } from "../../features/memory/Memory.tsx";
import { Corpus } from "../../features/corpus/Corpus.tsx";
import { Research } from "../../features/research/Research.tsx";
import { Tasks } from "../../features/tasks/Tasks.tsx";
import { Calendar } from "../../features/calendar/Calendar.tsx";
import { Notes } from "../../features/notes/Notes.tsx";
import { Documents } from "../../features/documents/Documents.tsx";

/** Every tool that can open as a window. The same components serve the full-page routes
 * (deep links like /calendar still work); the window is just another mount point. */
export const WINDOW_TOOLS: Array<{ key: string; title: string; node: ReactNode }> = [
  { key: "models", title: "Providers", node: <Providers /> },
  { key: "memory", title: "Memory", node: <Memory /> },
  { key: "corpus", title: "Corpus", node: <Corpus /> },
  { key: "research", title: "Research", node: <Research /> },
  { key: "tasks", title: "Tasks", node: <Tasks /> },
  { key: "calendar", title: "Calendar", node: <Calendar /> },
  { key: "notes", title: "Notes", node: <Notes /> },
  { key: "documents", title: "Documents", node: <Documents /> },
];

export const toolByKey = new Map(WINDOW_TOOLS.map((t) => [t.key, t]));
