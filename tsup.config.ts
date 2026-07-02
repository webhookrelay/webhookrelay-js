import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "generated/api": "src/generated/api.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // `ws` is optional and loaded lazily at runtime only in Node environments
  // that lack a global WebSocket. Never bundle it — browsers use the native
  // WebSocket and should not pull `ws` in.
  external: ["ws"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
