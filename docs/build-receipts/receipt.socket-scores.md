# Receipt: Socket scores for @senscheck/governance-core 0.1.0

Date: 2026-11-20

## Scores on socket.dev (0.1.0)

| Category | Score |
|---|---|
| Supply chain | 77 |
| Vulnerability | 100 |
| Quality | 80 |
| Maintenance | 88 |
| License | 100 |

One package alert: environment variable access, from `EnvironmentAuthorityProvider` defaulting to `process.env`.

## What changed

`EnvironmentAuthorityProvider` now takes an explicit map and grants nothing when the map is omitted. Shipped code is gated by `scripts/release-check.mjs` so a future tarball that reads `process.env` fails the release check.

## What a republish can change

Clearing that alert removes the only supply-chain finding. Socket's published formula still weights weekly downloads, GitHub stars/forks/watchers, maintainer count, and release history. Those are why supply chain, quality, and maintenance are below 100. Vulnerability and license are already 100.

## Verification

`pnpm exec vitest run packages/core/test/receipt-providers.test.ts` — 11 passed.
