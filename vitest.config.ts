import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@senscheck/governance-core/node", replacement: p("./packages/core/src/node.ts") },
      { find: "@senscheck/governance-core", replacement: p("./packages/core/src/index.ts") },
      { find: "@senscheck/governance-mcp", replacement: p("./packages/mcp/src/index.ts") },
      { find: "@senscheck/generic-tools", replacement: p("./packages/adapters/generic/src/index.ts") },
      { find: "@senscheck/governance-openai", replacement: p("./packages/adapters/openai/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "packages/adapters/*/src/**/*.ts"],
      exclude: ["**/bin.ts", "**/commercial.ts", "**/types.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      thresholds: {
        // Authorization decision engine: 100% branch coverage.
        "packages/core/src/engine.ts": { branches: 100 },
        "packages/core/src/effect.ts": { branches: 100 },
        "packages/core/src/policy/local.ts": { branches: 100 },
        "packages/core/src/policy/glob.ts": { branches: 100 },
      },
    },
  },
});
