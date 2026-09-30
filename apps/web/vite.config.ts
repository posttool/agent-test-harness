import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.HARNESS_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), skin: resolve(import.meta.dirname, "skin.html") } },
  },
  server: {
    port: 5173,
    proxy: { "/ws": { target: server.replace("http", "ws"), ws: true }, "/api": server },
  },
});
