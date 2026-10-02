# Concepts

```
INTELLIGENCE != AUTHORITY
UNKNOWN != ALLOW
GOVERNANCE FAILURE = NO CONSEQUENTIAL AUTHORITY
```

A model or agent **proposes** an effect. It never grants itself authority to execute. Reasoning is evidence for a proposal, never execution authority.

## Decisions

| Decision | Meaning | Callback runs? |
|---|---|---|
| `ALLOW` | Policy, authority, freshness and (if needed) approval all hold | yes |
| `DENY` | Policy or authority refused | no |
| `REQUIRE_APPROVAL` | Needs independent human approval that is absent or pending | no |
| `FAIL_CLOSED` | Governance could not be established (missing, stale, conflicting, malformed, unavailable, timed out, invalid effect) | no |

## Pipeline

canonicalize → identity (optional) → context (optional) → risk (can only raise) → policy (all providers, unanimity) → authority → approval (if policy or risk requires) → ALLOW receipt written → final gate (authority re-checked, decision age, expiry, replay) → callback → completion receipt.

## Invariants

| ID | Invariant |
|---|---|
| FC-001 | No governed consequential action executes without a final governance decision |
| FC-002 | Missing governance fails closed |
| FC-003 | Unavailable governance fails closed |
| FC-004 | Policy evaluation error fails closed |
| FC-005 | Policy timeout fails closed |
| FC-006 | Malformed policy response fails closed |
| FC-007 | Stale authority fails closed |
| FC-008 | Conflicting governance fails closed |
| FC-009 | The governed agent cannot authorize itself |
| FC-010 | Natural-language reasoning cannot override a deterministic denial |
| FC-011 | Authorization applies to a canonicalized effect, not free text |
| FC-012 | Materially changing an authorized effect requires reauthorization |
| FC-013 | High-risk actions can require independent human approval |
| FC-014 | ALLOW, DENY, REQUIRE_APPROVAL and FAIL_CLOSED produce receipts |
| FC-015 | A denied operation never invokes the callback |
| FC-016 | A FAIL_CLOSED operation never invokes the callback |
| FC-017 | Exceptions narrow authority; they never silently expand it |
| FC-018 | Unknown risk or malformed effect data defaults to the safer state |
| FC-019 | The final check occurs as close as practical to effectuation |
| FC-020 | No plugin, provider or adapter may weaken these invariants |

Each is exercised in `packages/core/test/invariants.test.ts` (tests are named by invariant).

## Composition rules

- Multiple policy providers must agree: any `FAIL_CLOSED` → `FAIL_CLOSED`; `ALLOW` + `DENY` → `FAIL_CLOSED` (`CONFLICTING_GOVERNANCE`); `DENY` beats `REQUIRE_APPROVAL` beats `ALLOW`. For deny-precedence rules inside one policy, use a single `LocalPolicyProvider`.
- Providers can only make a decision stricter: a `RiskProvider` may raise but not lower risk; unknown context cannot satisfy an ALLOW rule.

## Scope

Core is an application-level boundary. See [SECURITY.md](../SECURITY.md).
