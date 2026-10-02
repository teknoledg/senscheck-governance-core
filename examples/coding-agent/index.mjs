// An AI coding agent proposes deleting a directory. Four situations, one wrapper.
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GovernanceBlockedError, createEffect } from "@senscheck/governance-core";
import { agent, assert, build, human, line } from "../_shared.mjs";

const exists = (p) => access(p).then(() => true, () => false);
const policy = {
  version: 1,
  default: "FAIL_CLOSED",
  rules: [
    { id: "deny-secrets-dir", when: { verb: "DELETE", resource: "file:*/secrets*" }, decision: "DENY" },
    { id: "allow-delete", when: { verb: "DELETE", resource: "file:*" }, decision: "ALLOW" },
  ],
};

const root = await mkdtemp(join(tmpdir(), "senscheck-coding-"));
const build1 = join(root, "build");
const secrets = join(root, "secrets");
await mkdir(build1);
await mkdir(secrets);

async function attempt(title, { governance }, target) {
  const safeDelete = governance.wrapFunction((dir) => rm(dir, { recursive: true }), {
    verb: "DELETE",
    resource: (dir) => `file:${dir}`,
    risk: "HIGH",
    parameters: (dir) => ({ dir }),
  });
  try {
    await safeDelete(target);
    line(title, "ALLOW -> directory deleted");
  } catch (err) {
    assert(err instanceof GovernanceBlockedError, "expected a governance block");
    line(title, `${err.decision} [${err.reasonCodes.join(",")}]`);
  }
}

// 1. High-risk, no approval yet.
const a = build(policy);
await attempt("1. no approval", a, build1);
assert(await exists(build1), "directory must survive without approval");

// 2. Policy denies, even if a human approved.
const digest2 = (await a.governance.evaluate(createEffect({ principal: agent, verb: "DELETE", resource: `file:${secrets}`, risk: "HIGH", parameters: { dir: secrets } }))).effectDigest;
a.approvals.approve(digest2, human);
await attempt("2. policy DENY (even if approved)", a, secrets);
assert(await exists(secrets), "denied directory must survive");

// 3. Authority provider unavailable.
const b = build(policy, { authorityProvider: { check: () => Promise.reject(new Error("authority service offline")) } });
await attempt("3. authority provider offline", b, build1);
assert(await exists(build1), "directory must survive when governance is unavailable");

// 4. Valid authority + independent human approval of exactly this effect.
const digest4 = (await a.governance.evaluate(createEffect({ principal: agent, verb: "DELETE", resource: `file:${build1}`, risk: "HIGH", parameters: { dir: build1 } }))).effectDigest;
a.approvals.approve(digest4, human);
await attempt("4. authority + human approval", a, build1);
assert(!(await exists(build1)), "approved directory should be deleted");

line("receipts written", a.receipts.receipts.length);
await rm(root, { recursive: true, force: true });
