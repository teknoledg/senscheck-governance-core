---
name: fail-closed-governance
description: Add a deterministic fail-closed governance boundary (SensCheck Governance Core) to an existing project that lets AI agents or tools change real things. Use when asked to "govern", "guardrail", "add approval", or "fail closed" an agent, tool loop, or MCP server.
---

# Fail-closed governance for an existing project

Principle: an agent proposes; it never authorizes itself. UNKNOWN != ALLOW. Governance failure = no consequential authority.

## Procedure

1. **Inventory side effects.** Search for filesystem mutations, `child_process`/shell, database writes, HTTP POST/PUT/PATCH/DELETE, cloud SDK mutations, deployment commands, credential changes. If `@senscheck/governance-cli` is available: `npx senscheck audit .` (a heuristic starting list, not proof).
2. **Install.** `npm install @senscheck/governance-core` (ESM, Node 20+, no network calls, no account). Optional: `@senscheck/governance-mcp`, `@senscheck/generic-tools`, `@senscheck/governance-openai`, `@senscheck/governance-cli`.
3. **Create one governance instance** in a module the agent code imports but cannot reconfigure:
   ```ts
   import { SensCheckGovernance, StaticAuthorityProvider, StaticApprovalProvider } from "@senscheck/governance-core";
   import { FileReceiptSink } from "@senscheck/governance-core/node";
   import policy from "./senscheck.config.json" with { type: "json" };

   export const approvals = new StaticApprovalProvider(); // only a human-facing surface may call approvals.approve()
   export const governance = new SensCheckGovernance({
     policies: [policy],
     authorityProvider: new StaticAuthorityProvider([/* operator-issued grants with expiry */]),
     approvalProvider: approvals,
     receiptSink: new FileReceiptSink(".senscheck/receipts.jsonl"),
     defaultPrincipal: { id: "my-agent", type: "agent" },
     timeout: 2000,
   });
   ```
4. **Wrap each side effect at the point it happens** (see the `secure-agent-tool` skill). Never rely only on a check in the agent loop.
5. **Write the policy** (`senscheck.config.json`): `default: "FAIL_CLOSED"`, explicit DENY for dangerous resources, REQUIRE_APPROVAL for production/high-risk, narrow ALLOW rules. `npx senscheck check` must pass. Deny beats allow.
6. **Wire human approval** through a channel the agent cannot reach (CLI prompt, review UI, ticket). The approver must be a human distinct from the principal, and approval binds to the exact effect digest and is single-use.
7. **Test fail-closed behaviour**: authority offline/timeout/malformed/stale, policy error/timeout/malformed, receipt sink failure, "human approved" in model text, modified effect after approval, replay. Assert the protected callback is never invoked. `npx senscheck test` runs a baseline suite.
8. **Explain residual risk** honestly: Core is an application-level boundary. It does not stop code that bypasses the wrapper, is not an OS sandbox/auth system/HSM, and receipts are tamper-evident only (unsigned).

## Never

- Return true / ALLOW from a `catch`, timeout, or missing config.
- Build the principal, authority, or approval from model output or tool arguments.
- Lower a risk level, widen an allowlist, or delete a test to get green.
- Implement a custom decision engine instead of using Core.
