# Policies

Configure with `senscheck.config.json` (schema: `packages/core/schema/policy.schema.json`) or pass an object to `policies: [...]`. `LocalPolicyProvider` validates strictly and **throws** on invalid config.

```json
{
  "version": 1,
  "default": "FAIL_CLOSED",
  "policyVersion": "2026-10-02",
  "verbAllowlist": ["READ", "WRITE", "DELETE", "DEPLOY"],
  "resourceDenylist": ["file:/etc/*"],
  "rules": [
    { "id": "deny-production-delete", "when": { "verb": "DELETE", "resource": "production:*" }, "decision": "DENY" },
    { "id": "approve-production-deploy", "when": { "verb": "DEPLOY", "resource": "production:*" }, "decision": "REQUIRE_APPROVAL" },
    { "id": "allow-staging", "when": { "resource": "staging:*" }, "except": { "verb": "DELETE" }, "decision": "ALLOW" }
  ]
}
```

## Evaluation order

1. `resourceDenylist` → DENY. 2. `verbAllowlist` / `resourceAllowlist` (if present) → DENY when outside. 3. Rules: **DENY > REQUIRE_APPROVAL > ALLOW**. 4. No match → `default` (`DENY` or `FAIL_CLOSED`; `ALLOW` is rejected).

## Conditions (`when` / `except`)

`verb`, `resource`, `principalId` (globs, string or list), `principalType`, `risk`, `riskAtLeast`, `environment`, `time` (`notBefore`, `notAfter`, `hoursUtc {from,to}`). Globs: `*` any run of characters, `?` one. Empty conditions are invalid.

## Safety rules

- **Exceptions narrow.** `except` is allowed only on ALLOW rules.
- **Unknown context is strict.** If a condition needs context that is unavailable (e.g. `environment` without a context), ALLOW rules do not match; DENY and REQUIRE_APPROVAL rules do.
- Policy decisions are from structured effects. Model prose is never policy.
- `risk` conditions use the *effective* risk (after any `RiskProvider` raised it).
- Environment comes from `GovernanceOptions.environment` or a `ContextProvider`, never from the effect.

Validate with `npx senscheck check`. Duplicate rule ids, unknown keys, and malformed values are errors.
