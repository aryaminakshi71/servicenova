import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**", "**/build/**"],
  },
});
