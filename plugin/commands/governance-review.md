---
name: governance-review
description: Trace every path from agent proposal to real side effect and classify fail-open, bypass and self-authorization risks.
---

Run the `governance-review` skill on this repository (or on the path I give: $ARGUMENTS).

1. Run `npx @senscheck/governance-cli audit .` if available, as a starting list only (heuristic).
2. Identify every consequential side effect, then trace proposal -> authorization -> actual effect.
3. List EVERY code path capable of reaching each side effect, including aliases, nested tools, alternate entry points, MCP servers and background jobs.
4. Classify each path: FAIL_OPEN, BYPASS, SELF_AUTH, STALE_AUTH, UNBOUND_EFFECT, MISSING_RECEIPT, POLICY_ERROR, APPROVAL_BYPASS, or OK.
5. Report as a table with file:line, category, why, and the smallest fix. Do not edit code unless I ask.
6. End with the residual risks that remain even after the fixes.
