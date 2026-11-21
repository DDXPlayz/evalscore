import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Production is served from tools.anantamracing.com/evalscore/, so that is the
  // default and a normal build is unchanged. A bare clone served at the root
  // needs VITE_BASE=/ at build time, or every asset 404s.
  base: process.env.VITE_BASE ?? '/evalscore/',
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/pdfjs-dist")) return "pdf";
          return undefined;
        },
      },
    },
  },
});
