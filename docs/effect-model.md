# Effect model

Every governed side effect is a typed, versioned **canonical effect** (schema: `packages/core/schema/effect.schema.json`).

```json
{
  "schemaVersion": "1.0",
  "effectId": "eff_...",
  "principal": { "id": "coding-agent", "type": "agent" },
  "action": { "verb": "DEPLOY", "resource": "production:api" },
  "parameters": { "version": "2.3.1" },
  "risk": "HIGH",
  "proposedAt": "2026-10-02T12:00:00.000Z",
  "metadata": {}
}
```

| Field | Rule |
|---|---|
| `schemaVersion` | exactly `"1.0"` |
| `effectId` | `[A-Za-z0-9_.:-]{1,128}`, single-use under `execute` |
| `principal` | `id` non-empty ≤256 chars, `type` ∈ agent/service/human/system |
| `action.verb` | `UPPER_SNAKE`, ≤64 |
| `action.resource` | non-empty, ≤1024, no control characters |
| `parameters` | JSON-only plain objects (no functions, bigint, NaN, Date, cycles; depth ≤32, ≤1 MB) |
| `risk` | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` |
| `proposedAt` | ISO-8601 |
| `metadata` | informational, **never consulted for decisions** |

Unknown top-level fields, missing fields, or invalid values yield `FAIL_CLOSED / INVALID_EFFECT`. Nothing is inferred.

`createEffect({ principal, verb, resource, risk, parameters })` fills `schemaVersion`, `effectId` and `proposedAt`.

## Canonicalization and digest

`canonicalizeEffect` returns a **deep-frozen clone** plus a sha256 **digest** over `schemaVersion`, `principal`, `action`, `parameters` and `risk` (sorted-key JSON). `effectId`, `proposedAt` and `metadata` are excluded, so two proposals of the same material effect share a digest; single-use is enforced by `effectId` and approval IDs. Approvals and optionally authority are bound to the digest. `metadata` is never passed to policy, risk, context, authority, approval or identity providers (it is recorded in receipts only), so nothing an approver or policy sees is outside the digest. The callback receives the frozen clone; `wrapFunction`, which calls your function with its live arguments, rebuilds the effect from them immediately before the call and refuses to run if the digest changed, so mutating an argument while governance is deciding cannot change what runs.

## Choosing verb, resource, risk

Resource is what policy matches on: normalize it (`file:${path.resolve(p)}`). When unsure of risk, round up. Principal must come from trusted context, never from model output.
