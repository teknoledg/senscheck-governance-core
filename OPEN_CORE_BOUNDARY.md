# Open-core boundary

SensCheck Governance — Core is the free, open (Apache-2.0) core. It is complete and useful alone. Optional commercial packages plug in through public interfaces and **cannot weaken Core's safety semantics**: Core validates every provider response and treats failure as FAIL_CLOSED.

## GREEN: implemented in this public repository

- deterministic fail-closed semantics (ALLOW / DENY / FAIL_CLOSED / REQUIRE_APPROVAL)
- canonical typed effects and effect digests
- local deterministic policy and configuration validation
- authority presence and freshness checks
- human approval gates (independent, effect-bound, single-use)
- provider interfaces and local providers
- tool wrappers and MCP wrappers
- basic receipts (unkeyed integrity digest)
- deny-by-default semantics; fail-closed timeout/error behaviour
- governance auditing and generic risk classification
- generic revocation hooks (authority re-check at effectuation)

## RED: not in this repository

The following are **not implemented, described, approximated, or specified here**, and must not be contributed:

- the internals of the commercial SensCheck Guardian
- MMRY's private context/provenance/temporal implementations
- SensAffect's proprietary inference/detection implementations
- Akita's proprietary identity/entitlement implementations
- any unpublished patent-candidate mechanism, algorithm, schema or enabling detail, including proprietary schemes for relating the evidence behind a decision, the authority behind it, and the effect that results from it
- any private data schema used by those products

If an implementation seems to require a RED mechanism: stop, define an interface, document what the interface requires, and do not invent or approximate the private algorithm.

## Extension points (interfaces only)

`src/commercial.ts` defines contract-only types: `SensCheckGuardianProvider` (a `PolicyProvider`), `MMRYContextProvider` (a `ContextProvider`), `SensAffectEvidenceProvider` (a `RiskProvider`, so evidence can only raise risk), `AkitaIdentityProvider` (`IdentityProvider` + `AuthorityProvider`). They carry no implementation. Using the free package is never contingent on buying anything.

## Contributor rule

Contributions that add anything from the RED list, or that make a Core invariant depend on a commercial package, will be rejected. See [CONTRIBUTING.md](CONTRIBUTING.md).
