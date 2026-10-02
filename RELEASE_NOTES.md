# Release notes: 0.1.0

First public release of SensCheck Governance — Core.

- `@senscheck/governance-core`: canonical effects, deterministic policy engine and config schema, authority/approval/identity/context/risk provider interfaces, local providers, receipts, `execute`/`wrapFunction`/`wrapTool`, FC-001..FC-020 invariants with executable tests and a 100% branch gate on the decision engine.
- `@senscheck/governance-mcp`: govern MCP tools (verified against the real `@modelcontextprotocol/sdk` in-memory transport).
- `@senscheck/governance-cli`: `init`, `audit`, `check`, `test`, `explain`.
- `@senscheck/generic-tools`, `@senscheck/governance-openai`: explicit adapters.
- Plugin: Cursor + portable Agent Plugin (3 skills, 1 rule, 2 commands).
- Not included: any commercial/proprietary mechanism (see OPEN_CORE_BOUNDARY.md); a `@senscheck/fail-closed` re-export package (optional, deferred).
- Known limitations: see SECURITY.md.
