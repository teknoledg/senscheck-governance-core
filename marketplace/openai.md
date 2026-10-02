# ChatGPT / Codex Agent Plugin submission

**Name:** SensCheck Governance — Core (`senscheck-governance-core`)
**Short description:** Review and implement fail-closed boundaries around consequential agent actions.
**Category:** Coding

Source of truth checked (2026-10-02): OpenAI Codex plugin docs ("Build plugins"). Found there: portable `plugin.json` at the plugin root (`$schema` https://agent-plugins.org/schemas/1.0.0/plugin.schema.json; `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`); OpenAI presentation under `extensions.com.openai` with `interface` (`displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, `websiteURL`, `privacyPolicyURL`, `termsOfServiceURL`, `defaultPrompt`, `brandColor`, `composerIcon`, `logo`, `screenshots`); paths relative to plugin root starting `./`; assets under `./assets/`; skills discovered from root `skills/`; public submission through the plugin submission portal.

Done here: root `plugin.json` (canonical), `.codex-plugin/plugin.json` (compat), three skills, all validated structurally by `pnpm validate:plugins`.

**Still needed before submission (not done, requires the publisher):**
- `privacyPolicyURL`/`termsOfServiceURL` now point to PRIVACY.md and TERMS.md on GitHub (drafts; they resolve publicly only once the repo is public; fill the governing-law clause in TERMS.md and have counsel review).
- Raster `logo`/`composerIcon` and `screenshots` if the portal requires PNG (the shipped logo is SVG).
- Submission through the portal; I could not verify its current field-level requirements (the docs pages for submission were not retrievable), so treat the list above as best-effort.
- The `.codex-plugin/plugin.json` compatibility schema is not fully documented; it is kept minimal.

## Listing copy
Agents fail. Fail closed. Point your agent at a repository and it will find consequential side effects and fail-open paths, wrap them with SensCheck Governance Core (canonical effects, deterministic policy, authority checks, human approval, receipts), generate policy and tests, run them, and report residual risk. Entirely local: no account, no network calls.

## Install
Codex/ChatGPT: install from the directory after publication, or add this repo as a local marketplace entry with `source: { source: "local", path: "./plugin" }`.
