import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Relative paths so the same build runs in Tauri and on GitHub Pages.
// The service worker lets the web version open offline on phones.
export default defineConfig({
  plugins: [react(), VitePWA({ registerType: "autoUpdate", manifest: false, workbox: { maximumFileSizeToCacheInBytes: 5e6 } })],
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
