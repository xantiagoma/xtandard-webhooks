import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Separate build for the bundled admin SPA. Output goes to dist/ui and is served
// by the package's static-assets handler. `base: "./"` keeps asset URLs relative
// so the SPA works under any mount path (/webhooks, /admin, ...) via an injected
// <base> tag.
export default defineConfig({
  root: "src/ui",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
});
