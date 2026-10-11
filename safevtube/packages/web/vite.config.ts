import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const target = "http://127.0.0.1:3939";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": target, "/media": target, "/ws": { target, ws: true } },
  },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), overlay: resolve(__dirname, "overlay.html"), tracker: resolve(__dirname, "tracker.html"), puppet: resolve(__dirname, "puppet.html") },
    },
  },
});
