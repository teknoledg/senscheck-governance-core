# Cursor plugin

`plugin/` is a Cursor plugin (`.cursor-plugin/plugin.json`, name `senscheck-governance-core`) containing:

- **Skills:** `fail-closed-governance`, `governance-review`, `secure-agent-tool`
- **Rule:** `rules/fail-closed.mdc` (`alwaysApply: false`, attached to TS/JS/Python)
- **Commands:** `/governance-review`, `/protect-tool`

## Install

Locally: copy or symlink `plugin/` into your Cursor plugins location, or install from the Cursor Marketplace once published (see `marketplace/cursor.md`). Cursor discovers components from the default `skills/`, `rules/`, `commands/` directories.

## Use

- `/governance-review`: traces proposal → authorization → actual effect, lists every path that reaches each side effect, classifies each as `FAIL_OPEN`, `BYPASS`, `SELF_AUTH`, `STALE_AUTH`, `UNBOUND_EFFECT`, `MISSING_RECEIPT`, `POLICY_ERROR`, `APPROVAL_BYPASS`, `OK`, and reports residual risk. It does not edit code unless asked.
- `/protect-tool`: select a function/tool, run the command; it installs Core, wraps the effect, writes policy, adds tests proving the callback does not run on DENY/FAIL_CLOSED, and runs them.

TypeScript/JavaScript first; the skills give language-neutral guidance for other stacks.
