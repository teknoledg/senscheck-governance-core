# npm submission

**Package:** `@senscheck/governance-core` (also `-mcp`, `-cli`, `@senscheck/generic-tools`, `@senscheck/governance-openai`)
**Title:** SensCheck Governance — Core
**Description (package.json):** Fail-closed governance for AI agents, tools and MCP servers.
**Keywords:** ai-agents, governance, fail-closed, mcp, policy, guardrails
**License:** Apache-2.0 · **Node:** >=20 · **Runtime deps (core):** none

## Before publishing
1. Confirm the `@senscheck` npm scope is owned by the publisher. If it is unavailable, rename via the `name` fields and the import specifiers in docs/tests (one global replace); keep the product name "SensCheck Governance — Core". Do not change the brand silently.
2. Confirm the `repository`/`homepage` URLs.
3. `pnpm install && pnpm verify && node scripts/release-check.mjs`
4. Publish in dependency order, with provenance if publishing from CI:
   `pnpm --filter @senscheck/governance-core publish --access public`, then mcp, generic-tools, openai, cli.
   (`pnpm publish` rewrites `workspace:^` to the real version range.) Publishing is a manual, human decision; nothing in this repo publishes automatically.

## Readme blurb
Agents fail. Fail closed. Wrap consequential tools and functions in a deterministic boundary: canonical effects, local policy, authority and freshness checks, independent human approval, receipts. Offline, no account, no telemetry. Not an OS sandbox or auth system.
