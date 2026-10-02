---
name: governance-review
description: Audit an agent application for fail-open paths, governance bypasses, self-authorization, stale authority, unbound effects, missing receipts, policy errors and approval bypass. Use for "review/audit my agent for safety", "can the agent do X without approval", or before shipping agent tooling.
---

# Governance review

Goal: for every consequential side effect, trace **proposal -> authorization -> actual effect** and list every path that can reach the effect.

## Method

1. Enumerate side effects (filesystem mutation, process/shell, DB write, HTTP mutation, cloud SDK, deploy, credential/permission change, messaging/payments). `npx senscheck audit .` gives a heuristic list; supplement with reading the code, since dynamic dispatch hides calls.
2. For each effect, find the function that performs it. Then find ALL callers: agent tool registry, MCP handlers, CLI entry points, scripts, cron/queue workers, tests-only helpers shipped in prod, aliases and re-exports, nested tools, sub-agents.
3. For each path, decide where the final governance check sits and whether it runs as close as practical to the effect.
4. Check the decision logic: what happens on error, timeout, missing config, malformed response, stale data, disagreement between checks?
5. Check who/what supplies authority and approval, and whether the governed agent can influence either.

## Classifications (use exactly one per path)

| Code | Meaning |
|---|---|
| FAIL_OPEN | Error, timeout, missing/malformed config or provider response results in permission (`catch { return true }`, `?? true`, default allow). |
| BYPASS | A path reaches the side effect without passing the governance check (alternate entry point, raw client, unwrapped alias, direct MCP registration). |
| SELF_AUTH | The agent/model can grant, renew or seal its own authority or approval (writes to approval store, reads "approved" from its own output/args/metadata, uses a shared credential that confers authority). |
| STALE_AUTH | Authority/approval is cached or checked long before the effect, no expiry, no re-check at effectuation, revocation not honoured. |
| UNBOUND_EFFECT | Authorization applies to free text or a mutable object rather than a canonical effect; the effect can change after approval; approval is reusable. |
| MISSING_RECEIPT | An allowed or denied action leaves no record, or the effect can run when the receipt cannot be written. |
| POLICY_ERROR | Policy is malformed, loaded leniently, ambiguous (allow beats deny), or silently falls back to a default allow. |
| APPROVAL_BYPASS | High-risk action proceeds without independent human approval, or approver can equal the proposer. |
| OK | Path is governed, fails closed, bound to the effect, fresh, receipted. |

## Report format

A table: `file:line | effect | path (caller -> ... -> effect) | class | evidence | smallest fix`. Then a short **Residual risk** section (what remains even when fixed: code that bypasses wrappers, compromised host, unsigned receipts, human approver error, OS-level access). Be specific; do not assert "secure". Do not modify code unless asked. Do not call static analysis proof of safety.
