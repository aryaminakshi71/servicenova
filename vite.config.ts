import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
  },
});
