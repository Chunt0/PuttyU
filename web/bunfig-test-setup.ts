import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Gives `bun test` a DOM so React Testing Library can render components.
// A real document URL lets relative request URLs (e.g. "/api/health") resolve.
GlobalRegistrator.register({ url: "http://localhost/" });
