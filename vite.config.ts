/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1422,
        }
      : undefined,
    watch: {
      // Tell vite to ignore watching src-tauri
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Default env is node (fast) for the pure-logic *.test.ts suite. UI tests
    // are *.test.tsx and opt into jsdom via a `// @vitest-environment jsdom`
    // docblock at the top of the file. The shared setup below is gated on a
    // real document, so node tests are unaffected.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});
