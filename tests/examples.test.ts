import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Integration: runs every example against the built workspace packages (run `pnpm build` first).
const examples = fileURLToPath(new URL("../examples/", import.meta.url));
describe("examples (built packages)", () => {
  it.each(["coding-agent", "filesystem-agent", "deployment-agent", "database-agent", "http-agent", "mcp-tool"])("%s exits 0", (name) => {
    const r = spawnSync("node", [`${name}/index.mjs`], { cwd: examples, encoding: "utf8" });
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
