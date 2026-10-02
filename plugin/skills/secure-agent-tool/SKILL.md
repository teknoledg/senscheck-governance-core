---
name: secure-agent-tool
description: Modify an existing function, agent tool or MCP operation so its consequential execution passes through SensCheck Governance Core (canonical effect, policy, authority, approval, receipt). Use when asked to "protect", "wrap", "govern" or "put approval on" a tool.
---

# Secure an agent tool

## Steps

1. **Locate the effect.** Find the exact statement that changes the world (write/delete/exec/POST/deploy). Read the callers; the wrap must sit on the function that every caller uses, as near the effect as practical.
2. **Choose the effect description.**
   - `verb`: UPPER_SNAKE (`DELETE`, `DEPLOY`, `WRITE`, `EXECUTE`, `HTTP_MUTATE`, `DB_WRITE`, ...).
   - `resource`: stable identifier, derived from the arguments and normalized (`file:${path.resolve(p)}`, `production:${service}`). Resolve paths so `..` cannot dodge policy.
   - `risk`: LOW / MEDIUM / HIGH / CRITICAL. HIGH and above require human approval by default. When unsure, round up.
   - `principal`: fixed at wrap time (or from trusted call context), never from model-controlled input.
   - `parameters`: JSON-serializable and complete enough that changing them changes the digest (for large payloads bind a sha256, not the bytes).
3. **Wrap it.**
   ```ts
   import { governance } from "./governance.js";
   export const deleteFile = governance.wrapFunction(rawDeleteFile, {
     verb: "DELETE",
     resource: ({ path }) => `file:${resolve(path)}`,
     risk: "HIGH",
   });
   ```
   Agent tool objects: `governance.wrapTool(tool, { verb, risk })`. MCP: `governMcpServer(server, { governance, principal, classify })` from `@senscheck/governance-mcp` and register tools through the returned object; keep the raw server private. Ready-made wrappers for fs, process, fetch and SQL are in `@senscheck/generic-tools`.
4. **Handle blocks.** Wrapped functions throw `GovernanceBlockedError` (with `.decision`, `.reasonCodes`) when not ALLOW. Surface a REQUIRE_APPROVAL to a human; do NOT retry in a loop and do NOT catch-and-continue. Never turn a block into a success message the model can reinterpret as "done".
5. **Remove or fence bypasses.** Delete or un-export the raw function; replace imports of the raw client in agent-reachable code.
6. **Add/extend policy** in `senscheck.config.json` (see `fail-closed-governance`), then `npx senscheck check`.
7. **Add tests** (vitest/jest/node:test): (a) DENY -> original not called; (b) authority provider throws/times out -> FAIL_CLOSED and not called; (c) HIGH risk without approval -> REQUIRE_APPROVAL and not called; (d) valid authority + human approval -> called exactly once; (e) changed arguments after approval -> not called; (f) replay -> not called.
8. **Run them** and report real output. If something fails, fix the cause, not the assertion.

## Language-neutral guidance (non-TypeScript stacks)

Core ships for TypeScript/JavaScript. For other stacks apply the same pattern by hand: canonicalize the effect to a typed record; evaluate deterministic policy; verify independent, fresh, effect-bound authority/approval; write the receipt before the effect; invoke the effect only on ALLOW; treat every error/timeout/malformed response as FAIL_CLOSED. Consider running a TypeScript sidecar rather than reimplementing the engine.
