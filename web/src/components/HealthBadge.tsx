import { useEffect, useState } from "react";

import { api } from "../api/client";

// Proves the typed client end-to-end: calls GET /api/health and renders it.
export function HealthBadge() {
  const [status, setStatus] = useState("…");

  useEffect(() => {
    let active = true;
    void api.GET("/api/health").then(({ data }) => {
      if (active && data) setStatus(`${data.status} · v${data.version}`);
    });
    return () => {
      active = false;
    };
  }, []);

  return <span>backend: {status}</span>;
}
