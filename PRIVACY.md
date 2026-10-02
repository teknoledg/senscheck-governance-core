# Privacy policy

**SensCheck Governance — Core** (the SDK, CLI, MCP and adapter packages, and the Cursor / Agent Plugin), published by TEKNOLED-G LIMITED ("we", "us").

_Last updated: 2026-10-02. DRAFT: have this reviewed by counsel before relying on it._

## Short version

SensCheck Governance — Core runs entirely on your machine or in your own infrastructure. **We do not collect, receive, store or sell any data from your use of it.** There are no accounts, no telemetry, no analytics and no network calls made by the software.

## What the software does with data

| Component | Reads | Writes | Sends off your machine |
|---|---|---|---|
| `@senscheck/governance-core`, `-mcp`, adapters | the effects, policies and provider responses you pass in | receipts only to the sink you configure (memory, console/stderr, or a file you choose) | nothing |
| `@senscheck/governance-cli` | files in directories you point it at (`audit`), your `senscheck.config.json`, receipt files you name (`explain`) | `senscheck.config.json`, an example file and a `.gitignore` entry (`init`) | nothing |
| Plugin (skills, rule, commands) | whatever your AI agent already has access to in your project | whatever edits you ask the agent to make | nothing by itself. See below |

Receipts can contain identifiers such as principal IDs, effect IDs, verbs and resource names (for example file paths). They do not include effect parameters. You control where they are stored; protect them like any log.

## AI agents and third parties

The plugin consists of instructions (skills, a rule and commands) that your AI coding agent (Cursor, ChatGPT/Codex or another) follows. Any data your agent sends to its model provider is governed by that provider's terms and privacy policy, not by us. We do not receive it.

If you choose to connect SensCheck Core to optional commercial services (for example a hosted policy or identity provider), those services have their own privacy terms.

## Our websites and repository

The source code is hosted on GitHub. GitHub processes data about visitors and contributors under GitHub's own privacy statement. If you email us (for example to report a vulnerability), we use the information you send only to respond and act on your message, and keep it no longer than needed.

## Your rights

Because we hold no personal data from your use of the software, there is nothing for us to export or delete. For anything we hold from correspondence, contact us to ask for access, correction or deletion; you may have rights under laws such as the GDPR/UK GDPR.

## Children

The software is a developer tool and is not directed at children.

## Changes

We will post changes in this file; the history is in the repository.

## Contact

TEKNOLED-G LIMITED. security@teknoledg.com
