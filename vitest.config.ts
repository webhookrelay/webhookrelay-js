import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Examples import the package by name; resolve it to the source under test.
    alias: { "@webhookrelay/sdk": new URL("./src/index.ts", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
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
