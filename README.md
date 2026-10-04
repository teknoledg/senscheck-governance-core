# SensCheck Governance — Core

**Agents fail. Fail closed.**
Deterministic governance boundaries for AI agents. Apache-2.0, offline, no account, no telemetry.

```bash
npm install @senscheck/governance-core
```

```ts
import { SensCheckGovernance, StaticAuthorityProvider, StaticApprovalProvider } from "@senscheck/governance-core";
import { rm } from "node:fs/promises";

const approvals = new StaticApprovalProvider(); // only a human-facing surface may call approvals.approve()
const governance = new SensCheckGovernance({
  policies: [{
    version: 1,
    default: "FAIL_CLOSED",
    rules: [
      { id: "deny-etc", when: { resource: "file:/etc/*" }, decision: "DENY" },
      { id: "allow-delete", when: { verb: "DELETE", resource: "file:*" }, decision: "ALLOW" },
    ],
  }],
  authorityProvider: new StaticAuthorityProvider([{
    principalId: "coding-agent", verbs: ["*"], resources: ["*"],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    grantedBy: { id: "ops-oncall", type: "human" },
  }]),
  approvalProvider: approvals,
  defaultPrincipal: { id: "coding-agent", type: "agent" },
});

export const safeDelete = governance.wrapFunction((path: string) => rm(path, { recursive: true }), {
  verb: "DELETE",
  resource: (path) => `file:${path}`,
  risk: "HIGH", // HIGH and CRITICAL need independent human approval by default
});

await safeDelete("/srv/build"); // throws GovernanceBlockedError(REQUIRE_APPROVAL); rm is never called
```

The protected function runs **only** on `ALLOW`. On `DENY`, `FAIL_CLOSED` or `REQUIRE_APPROVAL` it is never invoked, and every outcome produces a receipt.

## What it protects

Consequential side effects an agent can trigger: file writes/deletes, process and shell execution, database writes, HTTP POST/PUT/PATCH/DELETE, deployments, credential changes, and MCP tool calls. You put an explicit, typed boundary at the function that performs the effect.

```
MODEL / AGENT -> PROPOSED EFFECT -> canonicalize -> policy -> authority -> freshness -> approval
                                                                   |
                                                    FINAL EFFECT GATE (re-check, replay guard)
                                                       |                          |
                                                     ALLOW                 DENY / FAIL_CLOSED
                                                       v                          x
                                                    EFFECT + RECEIPT        NO EFFECT + RECEIPT
```

## What FAIL_CLOSED means

`DENY` means policy said no. `FAIL_CLOSED` means governance could not be established: missing, stale, conflicting, malformed, unavailable or timed-out policy, authority or receipt storage, or an invalid effect. Both stop the effect. They are different states because an outage and a refusal need different responses.

```
INTELLIGENCE != AUTHORITY        UNKNOWN != ALLOW        GOVERNANCE FAILURE = NO CONSEQUENTIAL AUTHORITY
```

## Why a model cannot authorize itself

Authority and approval come from providers **you** configure, outside the model's reach. Core rejects authority issued by the principal itself or by an agent/model; requires approvers to be a human distinct from the proposer; binds approvals to the exact effect digest (change a parameter and it needs fresh approval); makes approvals and effect IDs single-use; and ignores anything the effect's `parameters` or `metadata` claim ("human approved", "ignore policy"). Unknown top-level fields make an effect invalid.

## Wrap a tool

```ts
const tool = governance.wrapTool({ name: "send_invoice", execute: sendInvoice }, { verb: "SEND", risk: "HIGH" });
```

Ready-made explicit wrappers (no monkey-patching): `@senscheck/generic-tools` for filesystem, process, fetch and SQL; `@senscheck/governance-openai` for OpenAI-style function tools.

## Configure policy

`senscheck.config.json` (validated; malformed config is never loaded and never falls back to ALLOW):

```json
{
  "version": 1,
  "default": "FAIL_CLOSED",
  "rules": [
    { "id": "deny-production-delete", "when": { "verb": "DELETE", "resource": "production:*" }, "decision": "DENY" },
    { "id": "approve-production-deploy", "when": { "verb": "DEPLOY", "resource": "production:*" }, "decision": "REQUIRE_APPROVAL" }
  ]
}
```

Deny beats approval beats allow. `default` can be `DENY` or `FAIL_CLOSED`, never `ALLOW`. See [docs/policies.md](docs/policies.md).

## Wrap MCP

```ts
import { governMcpServer } from "@senscheck/governance-mcp";
const governed = governMcpServer(server, {
  governance, principal: { id: "mcp-client", type: "agent" }, serverName: "notes",
  classify: { read_note: "READ_ONLY", add_note: "MUTATING", wipe_notes: "DESTRUCTIVE" },
});
governed.registerTool("wipe_notes", { inputSchema: { confirm: z.boolean() } }, handler); // schemas preserved
```

Unclassified tools default to `PRIVILEGED` (needs approval). Tool-reported annotations are ignored unless you set `trustAnnotations`. Blocked calls return an MCP `isError` result. See [docs/mcp.md](docs/mcp.md).

## CLI

```bash
npx @senscheck/governance-cli init      # config, example wrapper, .gitignore entry
npx @senscheck/governance-cli audit .   # heuristic list of consequential operations (not proof of safety)
npx @senscheck/governance-cli check     # validate policy
npx @senscheck/governance-cli test      # 20+ fail-closed behavioural checks against the real engine
npx @senscheck/governance-cli explain .senscheck/receipts.jsonl
```

## Cursor plugin, portable Agent Plugin, governance-review

[`plugin/`](plugin) contains one portable plugin: skills `fail-closed-governance`, `governance-review`, `secure-agent-tool`; rule `fail-closed.mdc`; commands `/governance-review` and `/protect-tool`; plus `.cursor-plugin/` and `.codex-plugin/` manifests. In Cursor, `/governance-review` traces proposal → authorization → effect and classifies each path as `FAIL_OPEN`, `BYPASS`, `SELF_AUTH`, `STALE_AUTH`, `UNBOUND_EFFECT`, `MISSING_RECEIPT`, `POLICY_ERROR`, `APPROVAL_BYPASS` or `OK`. See [docs/cursor.md](docs/cursor.md) and [docs/agent-plugin.md](docs/agent-plugin.md).

## What the free package does not claim

SensCheck Core is an **application-level governance SDK**. It is not an OS sandbox, hardware security module, authentication system, safety-certified machinery controller, substitute for robot functional-safety systems, or a guarantee against malicious host code that bypasses your wrappers. Receipts carry an unkeyed hash: tamper-evident, not signed or non-repudiable. See [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).

## Commercial extensions

Core is complete without them. Optional packages plug in through the same provider interfaces (`PolicyProvider`, `AuthorityProvider`, `IdentityProvider`, `ContextProvider`, `RiskProvider`, ...) and can never weaken the invariants, since Core re-validates every response. Contracts only are documented here; see [OPEN_CORE_BOUNDARY.md](OPEN_CORE_BOUNDARY.md) and [docs/enterprise-upgrade.md](docs/enterprise-upgrade.md).

## Repository

| Path | Package |
|---|---|
| `packages/core` | `@senscheck/governance-core` |
| `packages/mcp` | `@senscheck/governance-mcp` |
| `packages/cli` | `@senscheck/governance-cli` |
| `packages/adapters/generic` | `@senscheck/generic-tools` |
| `packages/adapters/openai` | `@senscheck/governance-openai` |
| `plugin/` | Cursor + portable Agent Plugin |
| `examples/` | six runnable examples (`pnpm --filter senscheck-examples run coding`) |

Develop: `pnpm install && pnpm verify` (Node 20+, pnpm 10).

License: Apache-2.0 (code). The SensCheck name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md). Verify official releases with [docs/RELEASING.md](docs/RELEASING.md). © TEKNOLED-G LIMITED.

## Site

The public site (lessons, privacy, terms and the JSON Schemas) lives in a separate repository, [teknoledg/senscheck-site](https://github.com/teknoledg/senscheck-site), and is served at https://senscheck.teknoledg.com. The SDK never contacts it.
