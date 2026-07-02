import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { App } from "./app/App";
import { AuthProvider } from "./features/auth/auth-context";
import { LoginPage } from "./features/auth/LoginPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { SetupPage } from "./features/auth/SetupPage";
import "./app/tokens.css";
import "./app/shell.css";
import "./features/auth/auth.css";

// Every surface is a deep-linkable URL (DESIGN-M0-M1 §8). The route tree grows
// with the milestones; M0.1 is setup/login plus the guarded shell.
const router = createBrowserRouter([
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/*",
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
