import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/scheduler")) {
            return "react";
          }
          if (id.includes("@monaco-editor") || id.includes("monaco-editor")) {
            return "monaco";
          }
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
