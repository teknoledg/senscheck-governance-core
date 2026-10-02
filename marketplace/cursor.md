# Cursor marketplace submission

**Name:** SensCheck Governance — Core (plugin id `senscheck-governance-core`)
**Short description:** Add deterministic fail-closed governance to AI agents and tools.

Source of truth checked (2026-10-02): Cursor docs "Plugins" and "Plugins reference". Requirements found there: `.cursor-plugin/plugin.json` with required `name` (lowercase kebab-case); optional `description`, `version`, `author`, `logo` (relative path), `rules`/`skills`/`commands`/`agents` paths; skills need `name` + `description` frontmatter; rules need `description` (optional `alwaysApply`, `globs`); commands accept optional `name`/`description`. Checklist: valid manifest, unique name, clear description, correct frontmatter, committed logo, README, tested.

Status here: `pnpm validate:plugins` verifies manifest fields, frontmatter, and that referenced paths exist. It does **not** replace Cursor's own review. The reference docs did not publish a full field schema for every optional field, so unlisted optional fields were not used.

Submit at https://cursor.com/marketplace/publish with the repository containing `plugin/` (a single-plugin repo may need the plugin at the repo root or a `.cursor-plugin/marketplace.json`; check the form's current instructions).

## Listing copy
Add a fail-closed boundary to AI agents. Skills to review a repo for fail-open paths (`/governance-review`), wrap tools and functions (`/protect-tool`), and a rule that keeps agents from granting themselves authority. Works fully offline with the open-source SensCheck Governance Core SDK. Not a sandbox; application-level governance only.

## Install (local)
Copy `plugin/` into your Cursor plugins directory (see Cursor docs for the path on your OS) and restart Cursor.
