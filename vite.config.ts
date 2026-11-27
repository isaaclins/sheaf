import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative paths so the same build runs in Tauri and on GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
