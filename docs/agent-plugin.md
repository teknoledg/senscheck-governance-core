# Portable Agent Plugin (ChatGPT / Codex and compatible agents)

`plugin/plugin.json` is the **canonical portable manifest** (Agent Plugin format: `plugin.json` at the plugin root, skills under `skills/<name>/SKILL.md`, OpenAI presentation under `extensions.com.openai.interface`). `.codex-plugin/plugin.json` is a compatibility manifest generated from the same facts; `.cursor-plugin/plugin.json` is Cursor's. Keep all three in sync: `pnpm validate:plugins` checks structure and name/version agreement.

The agent can: review a repository, identify consequential side effects and fail-open paths, propose a patch, install `@senscheck/governance-core`, wrap tools/functions, generate `senscheck.config.json`, generate and run tests, and explain remaining risks. Everything works locally; the commercial SensCheck service is not required.

## Install

- **Codex / ChatGPT:** install from the plugin directory after publication, or add the repository as a local marketplace entry pointing at `./plugin`.
- **Any agent supporting Agent Skills:** point it at `plugin/skills/`.

See `marketplace/openai.md` for submission steps and the platform-field checklist.
