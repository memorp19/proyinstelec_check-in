import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "node_modules",
        ".next",
        "vitest.setup.ts",
        "**/*.d.ts",
        "app/**",          // pages — tested via e2e, not unit
        "src/lib/dynamo-client.ts", // singleton wrapper, tested via integration
      ],
    },
  },
});
