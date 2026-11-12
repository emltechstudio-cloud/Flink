import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "frontend",
  base: "./",
  server: {
    allowedHosts: [".us1.manus.computer", ".us3.manus.computer", ".us4.manus.computer"],
  },
  resolve: {
    alias: { "@": new URL("./frontend/src", import.meta.url).pathname },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
