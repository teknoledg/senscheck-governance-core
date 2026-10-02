# @senscheck/governance-core

**SensCheck Governance — Core.** Fail-closed governance for AI agents, tools and MCP servers. Agents fail. Fail closed.

```bash
npm install @senscheck/governance-core
```

```ts
import { SensCheckGovernance, StaticAuthorityProvider } from "@senscheck/governance-core";

const governance = new SensCheckGovernance({
  policies: [{ version: 1, default: "FAIL_CLOSED", rules: [{ id: "allow-writes", when: { verb: "WRITE", resource: "file:/srv/app/*" }, decision: "ALLOW" }] }],
  authorityProvider: new StaticAuthorityProvider([{
    principalId: "my-agent", verbs: ["*"], resources: ["*"],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    grantedBy: { id: "operator", type: "human" },
  }]),
  defaultPrincipal: { id: "my-agent", type: "agent" },
});

const safeWrite = governance.wrapFunction(writeFile, { verb: "WRITE", resource: (p: string) => `file:${p}`, risk: "MEDIUM" });
```

The wrapped function runs only on `ALLOW`. `DENY`, `FAIL_CLOSED` (missing/stale/conflicting/malformed/unavailable/timed-out governance) and `REQUIRE_APPROVAL` never invoke it, and every decision writes a receipt.

API: `evaluate`, `authorize`, `execute`, `wrapFunction`, `wrapTool`, `createReceipt`, `verifyReceipt`, `createEffect`, `canonicalizeEffect`, `validatePolicyConfig`, `LocalPolicyProvider`, local providers. `@senscheck/governance-core/node` adds `FileReceiptSink` and `TerminalApprovalProvider`. JSON Schemas: `@senscheck/governance-core/schema/{policy,effect,receipt}.schema.json`.

Zero runtime dependencies, ESM, Node 20+, no network calls, no telemetry. Application-level boundary only: not an OS sandbox, auth system or safety-certified controller. Full docs: https://github.com/teknoledg/senscheck-governance-core
