/**
 * INTEGRATION CONTRACTS ONLY. No implementation lives in this repository.
 *
 * These interfaces describe how optional commercial packages plug into Core through the same provider
 * interfaces local providers use. They carry no proprietary logic, and Core is fully functional without them.
 * No provider, commercial or otherwise, may weaken the FC-001..FC-020 invariants: Core re-validates every
 * response and treats errors, timeouts and malformed output as FAIL_CLOSED.
 */
import type { AuthorityProvider, ContextProvider, IdentityProvider, PolicyProvider, RiskProvider } from "./types.js";

/** Contract for a hosted/commercial policy service (e.g. @senscheck/guardian). It is just a PolicyProvider. */
export interface SensCheckGuardianProvider extends PolicyProvider {
  readonly kind: "senscheck-guardian";
}

/** Contract for a context/provenance supplier (e.g. @mmry/senscheck). Supplies context; never authority. */
export interface MMRYContextProvider extends ContextProvider {
  readonly kind: "mmry-context";
}

/** Contract for contextual-evidence suppliers (e.g. @sensaffect/senscheck). Evidence may only raise risk. */
export interface SensAffectEvidenceProvider extends RiskProvider {
  readonly kind: "sensaffect-evidence";
}

/** Contract for identity and entitlement (e.g. @akita/senscheck). */
export interface AkitaIdentityProvider extends IdentityProvider, AuthorityProvider {
  readonly kind: "akita-identity";
}
