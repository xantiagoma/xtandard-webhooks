import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Library build for the advanced `@xtandard/webhooks/react` component export.
// Emits dist/react.js (ESM) + dist/react.css. React is a peer (external);
// everything else (TanStack Query, styles) is bundled so the components are
// self-contained. emptyOutDir:false to preserve the library + UI builds.
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
