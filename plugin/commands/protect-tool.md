---
name: protect-tool
description: Wrap the selected consequential function, tool or MCP operation with SensCheck Governance Core.
---

Apply the `secure-agent-tool` skill to the code I have selected (or the function/tool I name: $ARGUMENTS).

1. Identify the exact line that performs the side effect, and who can call it.
2. Add `@senscheck/governance-core` if missing. Wrap at the effect function with `wrapFunction`/`wrapTool`, or use `execute` for inline effects.
3. Set verb, resource and risk deliberately. Bind a fixed principal, never one taken from tool arguments.
4. Add or update `senscheck.config.json` with the narrowest rules (default FAIL_CLOSED, explicit DENY for known-bad resources, REQUIRE_APPROVAL for high risk).
5. Add tests proving the original function is NOT called on DENY and FAIL_CLOSED, and is called once on a valid ALLOW.
6. Run the tests and `senscheck check`. Show results honestly, including failures.
