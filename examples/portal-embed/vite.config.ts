import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /portal-token → the demo server started by start.ts. It stands in for
// the HOST APP's own session-guarded mint route, so it must look same-origin.
// The panel API itself is reached cross-origin at :3701 — the panel's `cors`
// option allows the Vite origin, which is the realistic multi-origin shape
// (portal on app.example.com, panel on api.example.com).
export default defineConfig({
  plugins: [react()],
  server: { port: 5190, proxy: { "/portal-token": "http://localhost:3701" } },
});
