// Governed filesystem mutations with @senscheck/generic-tools.
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { governFs } from "@senscheck/generic-tools";
import { GovernanceBlockedError } from "@senscheck/governance-core";
import { agent, assert, build, line } from "../_shared.mjs";

// Policy matches real locations (symlinks are followed), so resolve the sandbox path first (macOS: /var -> /private/var).
const dir = await realpath(await mkdtemp(join(tmpdir(), "senscheck-fs-")));
const { governance } = build({
  version: 1,
  default: "FAIL_CLOSED",
  resourceDenylist: ["file:/etc/*"],
  rules: [{ id: "allow-writes-in-sandbox", when: { verb: ["WRITE", "CREATE_DIR"], resource: `file:${dir}*` }, decision: "ALLOW" }],
});
const gfs = governFs(fs, { governance, principal: agent });

await gfs.writeFile(join(dir, "notes.txt"), "hello");
line("write inside sandbox", `ok (${await readFile(join(dir, "notes.txt"), "utf8")})`);

for (const [label, op] of [
  ["write to /etc/hosts", () => gfs.writeFile("/etc/hosts", "x")],
  ["write outside sandbox", () => gfs.writeFile("/tmp/elsewhere.txt", "x")],
  ["recursive delete of sandbox", () => gfs.rm(dir, { recursive: true })],
]) {
  try {
    await op();
    assert(false, `${label} should have been blocked`);
  } catch (err) {
    assert(err instanceof GovernanceBlockedError, "expected a governance block");
    line(label, `${err.decision} [${err.reasonCodes.join(",")}]`);
  }
}
assert((await readFile(join(dir, "notes.txt"), "utf8")) === "hello", "sandbox must be intact");
await rm(dir, { recursive: true, force: true });
