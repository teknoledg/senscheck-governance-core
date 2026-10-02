# Receipts

Every decision produces a receipt (schema: `packages/core/schema/receipt.schema.json`).

```json
{
  "receiptVersion": "1.0",
  "receiptId": "rcpt_...",
  "effectId": "eff_...",
  "effectDigest": "3748629e...",
  "principalId": "coding-agent",
  "decision": "DENY",
  "reasonCodes": ["POLICY_DENY"],
  "authorized": false,
  "attempted": false,
  "occurred": false,
  "phase": "DECIDED",
  "evaluatedAt": "2026-10-02T12:00:00.000Z",
  "policyVersion": "local-policy@2026-10-02",
  "metadata": { "verb": "DELETE", "resource": "production:db", "matchedRuleIds": ["deny-production-delete"] },
  "integrity": { "algorithm": "sha256", "digest": "..." }
}
```

## authorized / attempted / executed / completed

| Term | Field | Meaning |
|---|---|---|
| authorized | `authorized` | governance returned ALLOW |
| attempted | `attempted` | the protected callback was invoked |
| executed | `occurred` | the callback returned without throwing: the only claim that the effect happened |
| completed | `phase` = `COMPLETED` / `FAILED` | the end-of-execution receipt was written |

`execute` writes an `AUTHORIZED` receipt **before** the callback (if it cannot be written the effect is blocked), then a `COMPLETED` (`occurred: true`) or `FAILED` (`attempted: true, occurred: false`; the effect may be partially applied) receipt. If the final gate blocks after the ALLOW receipt, a `FAIL_CLOSED` receipt follows.

## Integrity, honestly

`integrity.digest` is an **unkeyed sha256** of the receipt body. It detects accidental or naive edits (`verifyReceipt`, `senscheck explain`). It is **not a signature**, provides no authenticity or non-repudiation, and cannot detect deletion or truncation. Write receipts to storage the agent cannot modify.

Receipts omit `parameters` (which may hold sensitive data) and include the effect digest, verb and resource.
