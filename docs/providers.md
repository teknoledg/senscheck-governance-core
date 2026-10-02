# Providers

All provider calls run under `timeout` (default 2000 ms). An exception, timeout, or response that fails shape validation is `FAIL_CLOSED` (`*_ERROR`, `*_TIMEOUT`, `*_MALFORMED_RESPONSE`). **Provider failure never produces permission.**

| Interface | Method | Purpose |
|---|---|---|
| `PolicyProvider` | `evaluate(input) → {decision, reasonCodes, policyVersion?, matchedRuleIds?}` | decide ALLOW/DENY/REQUIRE_APPROVAL/FAIL_CLOSED |
| `AuthorityProvider` | `check(req) → {status, principalId, grantedBy, observedAt, expiresAt, effectDigest?}` | does the principal hold authority, until when, issued by whom |
| `ApprovalProvider` | `check(req) → {status, approver, approvedAt, effectDigest, expiresAt?, approvalId?}` | independent human approval |
| `IdentityProvider` | `verify(principal) → {verified}` | optional identity check |
| `ContextProvider` | `getContext(effect) → {environment?, ...}` | trusted context for policy |
| `RiskProvider` | `assess(effect) → RiskLevel` | may only **raise** risk |
| `ReceiptSink` | `write(receipt)` | persist receipts; failure blocks ALLOW |
| `AuditSink` | `record(event)` | optional; failures are ignored |

## Authority validation (enforced by Core, whatever the provider)

`principalId` must equal the effect's principal; `grantedBy` must not be the principal or an agent/model/llm/ai/assistant; `expiresAt` required and in the future; `observedAt` within `maxAuthorityAgeMs` (default 60 s) and not in the future; `effectDigest`, if present, must match. Re-checked just before execution.

## Approval validation

Approver must be `type: "human"` and not the proposer; `effectDigest` must equal the effect's; not expired (`expiresAt`, `maxApprovalAgeMs` default 15 min); `approvalId` single-use.

## Local providers (free)

`LocalPolicyProvider`, `StaticAuthorityProvider`, `EnvironmentAuthorityProvider` (weak by design), `StaticApprovalProvider`, `CallbackApprovalProvider`, `MemoryReceiptSink`, `ConsoleReceiptSink` (stderr), and from `@senscheck/governance-core/node`: `FileReceiptSink` (append-only JSONL), `TerminalApprovalProvider`.

## Commercial contracts

`SensCheckGuardianProvider`, `MMRYContextProvider`, `SensAffectEvidenceProvider`, `AkitaIdentityProvider` are **interfaces only** in `commercial.ts`. See [enterprise-upgrade.md](enterprise-upgrade.md).
