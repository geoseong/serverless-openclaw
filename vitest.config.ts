import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "references/**",
      "**/*.e2e.test.ts",
    ],
  },
});
