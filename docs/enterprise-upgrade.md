# Enterprise and commercial extensions

Core is fully functional without any of these. They plug into the same provider interfaces and cannot weaken the invariants because Core re-validates every response.

```
Agent -> Governance Core -+- Local Policy
                          +- SensCheck Guardian   (PolicyProvider)
                          +- Akita                (IdentityProvider + AuthorityProvider)
                          +- MMRY                 (ContextProvider)
                          +- SensAffect           (RiskProvider: evidence may only raise risk)
```

Planned package names: `@senscheck/guardian`, `@senscheck/enterprise`, `@mmry/senscheck`, `@sensaffect/senscheck`, `@akita/senscheck`.

This repository contains **contracts only** (`packages/core/src/commercial.ts`): no proprietary logic. See [OPEN_CORE_BOUNDARY.md](../OPEN_CORE_BOUNDARY.md). Integration pattern:

```ts
new SensCheckGovernance({
  policies: [localPolicy, guardianProvider],  // must agree; a disagreement fails closed
  authorityProvider: akitaProvider,
  contextProvider: mmryProvider,
  riskProvider: sensAffectProvider,
});
```
