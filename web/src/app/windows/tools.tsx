import type { ReactNode } from "react";
import { Providers } from "../../features/models/Providers.tsx";
import { Memory } from "../../features/memory/Memory.tsx";
import { Corpus } from "../../features/corpus/Corpus.tsx";
import { Library } from "../../features/library/Library.tsx";
import { PdfViewer } from "../../features/library/PdfViewer.tsx";
import { Dashboard } from "../../features/dashboard/Dashboard.tsx";
import { Progress } from "../../features/progress/Progress.tsx";
import { Review } from "../../features/practice/Review.tsx";
import { Gym } from "../../features/practice/Gym.tsx";
import { Exam } from "../../features/practice/Exam.tsx";
import { Calibration } from "../../features/practice/Calibration.tsx";
import { Explain } from "../../features/practice/Explain.tsx";
import { Worksheet } from "../../features/worksheet/Worksheet.tsx";
import { Canvas } from "../../features/canvas/Canvas.tsx";
import { Research } from "../../features/research/Research.tsx";
import { Tasks } from "../../features/tasks/Tasks.tsx";
import { Calendar } from "../../features/calendar/Calendar.tsx";
import { Notes } from "../../features/notes/Notes.tsx";
import { Documents } from "../../features/documents/Documents.tsx";
import { Miner } from "../../features/schedule/Miner.tsx";

/** Every tool that can open as a window. The same components serve the full-page routes
 * (deep links like /calendar still work); the window is just another mount point.
 * `hidden` tools (the PDF viewer) open programmatically, not from the sidebar nav. */
export const WINDOW_TOOLS: Array<{ key: string; title: string; node: ReactNode; hidden?: boolean }> = [
  { key: "dashboard", title: "Dashboard", node: <Dashboard /> },
  { key: "library", title: "Library", node: <Library /> },
  { key: "progress", title: "Progress", node: <Progress /> },
  { key: "review", title: "Review", node: <Review /> },
  { key: "gym", title: "Gym", node: <Gym /> },
  { key: "exam", title: "Exam", node: <Exam /> },
  { key: "calibration", title: "Calibration", node: <Calibration /> },
  { key: "explain", title: "Explain", node: <Explain /> },
  { key: "worksheet", title: "Worksheet", node: <Worksheet /> },
  { key: "canvas", title: "Canvas", node: <Canvas /> },
  { key: "models", title: "Providers", node: <Providers /> },
  { key: "memory", title: "Memory", node: <Memory /> },
  { key: "corpus", title: "Corpus", node: <Corpus /> },
  { key: "research", title: "Research", node: <Research /> },
  { key: "tasks", title: "Tasks", node: <Tasks /> },
  { key: "calendar", title: "Calendar", node: <Calendar /> },
  { key: "notes", title: "Notes", node: <Notes /> },
  { key: "documents", title: "Documents", node: <Documents /> },
  { key: "pdf", title: "PDF", node: <PdfViewer />, hidden: true },
  { key: "miner", title: "Schedule miner", node: <Miner />, hidden: true },
];

export const toolByKey = new Map(WINDOW_TOOLS.map((t) => [t.key, t]));
