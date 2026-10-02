# Contributing

1. `pnpm install`, then `pnpm verify` (build, lint, tests with coverage gates, schema and plugin validation).
2. Safety first: a change must not fail open, allow agent self-authorization, let prose override deterministic policy, or silently change an effect after authorization. Add a test for any behaviour you touch; the decision engine requires 100% branch coverage.
3. Do not weaken or delete a test to get green. Fix the cause.
4. Do not add runtime dependencies to `@senscheck/governance-core` without discussion. No network calls, no telemetry.
5. Respect [OPEN_CORE_BOUNDARY.md](OPEN_CORE_BOUNDARY.md). Anything on the RED list is rejected.
6. Describe behaviour you actually ran. Do not claim safety properties the SDK does not provide.

By contributing you agree your work is licensed under Apache-2.0.
