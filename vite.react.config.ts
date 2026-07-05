import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Library build for the advanced `@xtandard/webhooks/react` component export.
// Emits dist/react.js (ESM) + dist/react.css. React is a peer (external);
// everything else (TanStack Query, styles) is bundled so the components are
// self-contained. emptyOutDir:false to preserve the library + UI builds.
//
// The emitted dist/react.css is a full Tailwind build (preflight + utilities);
// `scripts/scope-embed-css.ts` runs after this build (see the `build:react`
// script) to scope every rule under `.xtandard-webhooks` so importing the
// stylesheet cannot leak into the host app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/react.tsx",
      formats: ["es"],
      fileName: () => "react.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
      output: { assetFileNames: "react.css" },
    },
  },
});
