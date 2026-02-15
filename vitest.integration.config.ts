import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/integration/**/*.test.ts"],
    testTimeout: 600_000, // 10 minutes — cold start can take 2+ minutes
    hookTimeout: 60_000,
  },
});
