# Quickstart

Requirements: Node 20+. No account, no network.

```bash
npm install @senscheck/governance-core
npx @senscheck/governance-cli init
```

`init` creates `senscheck.config.json`, `senscheck.example.mjs` and a `.gitignore` entry. Then:

```bash
npx @senscheck/governance-cli check     # validate the policy
npx @senscheck/governance-cli test      # fail-closed behavioural checks
node senscheck.example.mjs
```

## Minimum integration (≈15 lines)

```ts
import { SensCheckGovernance, StaticAuthorityProvider } from "@senscheck/governance-core";
import policy from "./senscheck.config.json" with { type: "json" };

export const governance = new SensCheckGovernance({
  policies: [policy],
  authorityProvider: new StaticAuthorityProvider([{
    principalId: "my-agent", verbs: ["*"], resources: ["*"],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    grantedBy: { id: "operator", type: "human" },
  }]),
  defaultPrincipal: { id: "my-agent", type: "agent" },
});

export const safeWrite = governance.wrapFunction(writeFile, {
  verb: "WRITE", resource: (p: string) => `file:${p}`, risk: "MEDIUM",
});
```

If the policy allows it and authority is valid, the function runs. Otherwise `GovernanceBlockedError` is thrown and the function is never called.

## Add human approval

HIGH/CRITICAL risk (and any `REQUIRE_APPROVAL` rule) needs an `ApprovalProvider`. `StaticApprovalProvider` records approvals made by *your* code (a CLI prompt, review UI, ticket webhook). The approval is bound to the effect digest, the approver must be a human other than the proposer, and it is single-use. `TerminalApprovalProvider` (from `@senscheck/governance-core/node`) asks at the terminal.

## Run the examples

```bash
pnpm install && pnpm --filter senscheck-examples run coding
```
