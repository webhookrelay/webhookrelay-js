import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // React bindings live in their own entry so the core never imports React.
    react: "src/react.tsx",
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
  external: ["ws", "react", "react-dom"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
