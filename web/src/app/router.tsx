import { createBrowserRouter } from "react-router-dom";
import { Shell } from "./Shell.tsx";
import { Placeholder } from "./Placeholder.tsx";
import { RequireAuth } from "../features/auth/RequireAuth.tsx";
import { Login } from "../features/auth/Login.tsx";
import { Home } from "../features/courses/Home.tsx";
import { Providers } from "../features/models/Providers.tsx";
import { Memory } from "../features/memory/Memory.tsx";
import { Corpus } from "../features/corpus/Corpus.tsx";
import { Library } from "../features/library/Library.tsx";
import { Progress } from "../features/progress/Progress.tsx";
import { Research } from "../features/research/Research.tsx";
import { Tasks } from "../features/tasks/Tasks.tsx";
import { Calendar } from "../features/calendar/Calendar.tsx";
import { Notes } from "../features/notes/Notes.tsx";
import { Documents } from "../features/documents/Documents.tsx";

// Public /login; everything else sits behind RequireAuth -> Shell. Feature routes beyond
// chat are typed Placeholders until their slice lands (SPEC §4).
export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: <RequireAuth />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <Home /> },
          { path: "models", element: <Providers /> },
          { path: "memory", element: <Memory /> },
          { path: "corpus", element: <Corpus /> },
          { path: "library", element: <Library /> },
          { path: "progress", element: <Progress /> },
          { path: "research", element: <Research /> },
          { path: "tasks", element: <Tasks /> },
          { path: "calendar", element: <Calendar /> },
          { path: "notes", element: <Notes /> },
          { path: "documents", element: <Documents /> },
          { path: "*", element: <Placeholder title="Not found" slice="—" /> },
        ],
      },
    ],
  },
]);
