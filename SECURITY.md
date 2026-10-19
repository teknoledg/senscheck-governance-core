# Security

## Reporting a vulnerability

Email **security@teknoledg.com** with a description and reproduction. Please do not open a public issue for a bypass of an FC invariant. We aim to acknowledge within 3 business days.

Anything that lets an effect run when governance returned DENY, FAIL_CLOSED or REQUIRE_APPROVAL, or lets an agent authorize itself, is treated as a security bug.

## What SensCheck Governance Core is

An **application-level governance SDK**: a deterministic decision boundary your code calls before a consequential side effect.

## What it is NOT

- a safety-certified machinery controller, or a substitute for robot functional-safety systems;
- an operating-system sandbox, container, or permission system;
- a hardware security module or key store;
- an authentication system (it consumes identity/authority from providers you supply);
- a guarantee that arbitrary malicious host code cannot bypass application code. If code can call the raw function, spawn a process, or edit the policy file, Core cannot stop it. Use OS/container/IAM controls as the real perimeter.

## Guarantees (and their scope)

The invariants FC-001..FC-020 (see [docs/concepts.md](docs/concepts.md)) hold for effects executed **through** `SensCheckGovernance.execute`/`wrapFunction`/`wrapTool` and the adapters. Each has an executable test in `packages/core/test` and the CLI `senscheck test` suite. The decision engine (`engine.ts`, `effect.ts`, `policy/local.ts`) has a 100% branch-coverage gate.

## Known limitations

- Receipts use an unkeyed sha256: tamper-evident only. No signatures, no non-repudiation, no chaining. Store them where the agent cannot write or delete (receipt deletion is out of scope for Core).
- Replay protection, and consumption of approvals, is in-memory per process. Multi-process deployments need a shared single-use store (implement via your own `ApprovalProvider`).
- A callback that has started cannot be rolled back or time-limited by Core.
- `EnvironmentAuthorityProvider` is weak by design: code that can set env vars in the process can grant itself authority.
- `StaticApprovalProvider.approve()` is a plain method: never expose it to the governed agent.
- `senscheck audit` is heuristic pattern matching, not proof.
- The SQL classifier in `@senscheck/generic-tools` is conservative but is not a SQL parser; use database permissions as the real boundary.

## Verifying releases

Releases after 0.1.0 are built and published by `.github/workflows/release.yml` with npm provenance and GitHub build attestations. How to check them: [docs/RELEASING.md](docs/RELEASING.md). Names and logos are covered by [TRADEMARKS.md](TRADEMARKS.md).

**0.1.0 is the exception: it carries no npm provenance or GitHub build attestation.** It was published from a maintainer machine, from tarballs that passed `scripts/release-check.mjs` (38 of 38 checks). An official 0.1.0 package matches these registry checksums (sha1, as `npm view <package>@0.1.0 dist.shasum` reports them):

| Package | dist.shasum |
|---|---|
| `@senscheck/governance-core` | `35079d4201034b239d6b314f467597e7c7c385bc` |
| `@senscheck/governance-cli` | `ca5c9f0d949c24371cc37337290695e42029ca1a` |
| `@senscheck/governance-mcp` | `cdcd9f579c3e516c40baea3815481f6cfca4da45` |
| `@senscheck/generic-tools` | `36b1279c76b2a7f96a56233faa75bf68ed737944` |
| `@senscheck/governance-openai` | `8d44a2a0ae0775113b5ca6583e4c06498e35d789` |

```bash
npm pack @senscheck/governance-core@0.1.0 && shasum senscheck-governance-core-0.1.0.tgz
```

From 0.1.1 on, a build without verifiable provenance is unofficial.

## Supply chain

Core has zero runtime dependencies. Releases are built from the repository by CI; verify with `npm pack` and compare tarball contents. No network access is performed by any package.
