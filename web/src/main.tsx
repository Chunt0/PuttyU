import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { App } from "./app/App";
import { HomePane } from "./app/HomePane";
import { AuthProvider } from "./features/auth/auth-context";
import { LoginPage } from "./features/auth/LoginPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { SetupPage } from "./features/auth/SetupPage";
import { ProvidersPage } from "./features/providers/ProvidersPage";
import "./app/tokens.css";
import "./app/themes.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/workspace.css";
import "./features/auth/auth.css";
import "./features/providers/providers.css";

// Every surface is a deep-linkable URL (DESIGN-M0-M1 §8). The route tree grows
// with the milestones; the App layout renders children into its content area.
const router = createBrowserRouter([
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePane /> },
      { path: "settings/providers", element: <ProvidersPage /> },
      { path: "*", element: <HomePane /> },
    ],
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
