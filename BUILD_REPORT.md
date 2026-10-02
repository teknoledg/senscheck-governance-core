# BUILD_REPORT: SensCheck Governance — Core 0.1.0

Generated 2026-10-02 from commands actually run in this checkout (Node 20.20.1, pnpm 10.12.3, TypeScript 5.9, vitest 4.1). Re-run: `pnpm install && pnpm verify && node scripts/release-check.mjs`.

## Packages built (`pnpm build`, all succeeded)

| Package | Tarball (`.artifacts/`) | Size |
|---|---|---|
| `@senscheck/governance-core` | senscheck-governance-core-0.1.0.tgz | 44K |
| `@senscheck/governance-mcp` | senscheck-governance-mcp-0.1.0.tgz | 12K |
| `@senscheck/governance-cli` | senscheck-governance-cli-0.1.0.tgz | 24K |
| `@senscheck/generic-tools` | senscheck-generic-tools-0.1.0.tgz | 12K |
| `@senscheck/governance-openai` | senscheck-governance-openai-0.1.0.tgz | 8K |

Core has zero runtime dependencies; the others depend only on `@senscheck/governance-core`.

## Tests: 242 passed, 0 failed

| Suite | Tests |
|---|---|
| core: invariants FC-001..FC-020 + adversarial | 89 |
| core: effect/canonicalization | 40 |
| core: policy engine + config validation | 42 |
| core: receipts + local providers | 11 |
| core: wrappers + FileReceiptSink | 12 |
| mcp (real `@modelcontextprotocol/sdk` client/server, in-memory) | 13 |
| cli | 16 |
| generic-tools / openai | 10 / 3 |
| integration: examples (built packages) | 6 |

Mandatory adversarial scenarios 1-20 are covered in `packages/core/test/invariants.test.ts` (offline/timeout/throwing/malformed/stale authority, policy unavailable/malformed/conflicting, "ignore policy", "human approved", self-authorization, effect modified after authorization, callback throws, callback not run on DENY/FAIL_CLOSED, high-risk without approval, unknown risk, missing resource/principal, replay incl. concurrent races). The CLI `senscheck test` runs 21 behavioural scenarios against the engine (21/21 pass, also from the packed artifact).

## Coverage (v8)

Overall: statements 98.07%, branches 97.61%, functions 96.34%, lines 98.48%.
**Decision engine branch coverage: 100%** for `engine.ts`, `effect.ts`, `policy/local.ts`, `policy/glob.ts` (enforced by a vitest threshold; the run passes). Policy config validation, receipts and canonicalization are also at/near 100%.
Not covered: `TerminalApprovalProvider` (`core/src/node.ts`, interactive stdin; untested) and some defensive branches in adapters.

## Other gates

- Typecheck (src + tests): pass. Lint (eslint, typescript-eslint): pass, 0 errors.
- JSON Schemas (policy/effect/receipt) compile under Ajv strict; agree with runtime validators on 12 policy fixtures + effect/receipt cases; `senscheck init` sample config validates. 20/20.
- Plugin validation (`scripts/validate-plugins.mjs`): 25/25 structural checks. This checks documented Cursor/OpenAI requirements as I found them; it is **not** the platforms' own validator or review.
- `pnpm audit`: no known vulnerabilities (dev dependencies upgraded to patched vitest/vite).
- Release check on packed artifacts: **37/37**: pack, tarball inspection (no tests/src/env/pem; no `workspace:` leaks), clean-fixture `npm install` from tarballs, all six examples and the CLI executed from the installed artifact with network access trapped (DNS/TCP/fetch abort), DENY/FAIL_CLOSED callback-never-runs proof, static scan for network APIs in shipped code, secret scan.

## Security tests

FC-001..FC-020 each have executable tests (including concurrent replay races and receipt-sink failure blocking effects). Threat model: THREAT_MODEL.md; limits: SECURITY.md.

## Marketplace validation: partial

- Cursor: manifest/frontmatter checked against the docs I could fetch; submission not performed.
- OpenAI/Codex: portable manifest matches the documented "Build plugins" format; the submission-portal requirements pages returned 404, so portal-specific requirements are unverified. Privacy/terms URLs and raster icons are missing (see `marketplace/openai.md`).
- npm: not published. The `@senscheck` scope availability was not checked.

## Known limitations / remaining non-blocking issues

- Receipts are unsigned (unkeyed sha256); replay and approval consumption are per-process memory.
- `@senscheck/fail-closed` convenience package not created (optional).
- `@senscheck/governance-openai` is structural (does not import or test against the OpenAI SDK).
- `senscheck audit` and the SQL classifier are heuristics.
- Contact emails set to security@ and conduct@teknoledg.com; repository URLs point to github.com/teknoledg/senscheck-governance-core (the repo itself must exist under that org).
- No git commit made; `git init` only.
- OPEN_CORE_BOUNDARY.md names RED categories generically and does not name or describe any patent-candidate mechanism.
