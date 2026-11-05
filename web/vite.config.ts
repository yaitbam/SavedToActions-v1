import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const server = "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { include: ["src/**/*.test.ts"] },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/auth": server,
    },
  },
});
