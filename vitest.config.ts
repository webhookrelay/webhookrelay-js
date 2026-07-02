import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The generated low-level client is not hand-written and not part of the
      // SDK's tested surface.
      exclude: ["src/generated/**"],
      reporter: ["text", "html"],
    },
  },
});
