/** The four governance outcomes. Never collapse these into a boolean: failure is not denial. */
export type GovernanceDecision = "ALLOW" | "DENY" | "FAIL_CLOSED" | "REQUIRE_APPROVAL";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const PRINCIPAL_TYPES = ["agent", "service", "human", "system"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export interface Principal {
  id: string;
  type: PrincipalType;
}

export interface EffectAction {
  /** UPPER_SNAKE verb, e.g. DELETE, DEPLOY. */
  verb: string;
  /** Opaque resource identifier, e.g. `file:/tmp/x`, `production:api`. */
  resource: string;
}

/** A canonical, versioned description of a proposed side effect. */
export interface Effect {
  schemaVersion: "1.0";
  effectId: string;
  principal: Principal;
  action: EffectAction;
  parameters: Record<string, unknown>;
  risk: RiskLevel;
  proposedAt: string;
  /** Informational only. Never consulted for any governance decision. */
  metadata: Record<string, unknown>;
}

export interface CanonicalEffect {
  readonly effect: Readonly<Effect>;
  /** sha256 over the material fields (principal, action, parameters, risk, schemaVersion). */
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Provider contracts
// ---------------------------------------------------------------------------

export interface GovernanceContext {
  environment?: string;
  [key: string]: unknown;
}

export interface PolicyEvaluationInput {
  effect: Readonly<Effect>;
  effectDigest: string;
  /** Risk after any RiskProvider raised it. Never lower than effect.risk. */
  effectiveRisk: RiskLevel;
  context: GovernanceContext;
  now: Date;
}

export interface PolicyResult {
  decision: GovernanceDecision;
  reasonCodes: string[];
  policyVersion?: string;
  matchedRuleIds?: string[];
}

export interface PolicyProvider {
  readonly id: string;
  evaluate(input: PolicyEvaluationInput): Promise<PolicyResult> | PolicyResult;
}

export interface AuthorityRequest {
  effect: Readonly<Effect>;
  effectDigest: string;
  context: GovernanceContext;
}

export interface AuthorityResponse {
  status: "GRANTED" | "NOT_GRANTED";
  /** The principal the authority was issued to. Must equal effect.principal.id. */
  principalId: string;
  /** Who issued the authority. An agent/model (or the principal itself) is self-authorization. */
  grantedBy: { id: string; type: string };
  /** ISO time the provider last observed the authority to be valid. */
  observedAt: string;
  /** ISO time after which the authority is invalid. Required: authority without a lifetime is rejected. */
  expiresAt: string;
  /** If present, the authority is bound to this exact effect digest. */
  effectDigest?: string;
  reasonCodes?: string[];
}

export interface AuthorityProvider {
  check(request: AuthorityRequest): Promise<AuthorityResponse> | AuthorityResponse;
}

export interface ApprovalRequest {
  effect: Readonly<Effect>;
  effectDigest: string;
  context: GovernanceContext;
}

export interface ApprovalResponse {
  status: "APPROVED" | "PENDING" | "REJECTED";
  approvalId?: string;
  /** Required when APPROVED. Must be a human distinct from the proposing principal. */
  approver?: { id: string; type: string };
  approvedAt?: string;
  /** Required when APPROVED: the approval is bound to this exact effect digest. */
  effectDigest?: string;
  expiresAt?: string;
}

export interface ApprovalProvider {
  check(request: ApprovalRequest): Promise<ApprovalResponse> | ApprovalResponse;
}

export interface IdentityProvider {
  verify(principal: Principal): Promise<{ verified: boolean }> | { verified: boolean };
}

export interface ContextProvider {
  getContext(effect: Readonly<Effect>): Promise<GovernanceContext> | GovernanceContext;
}

export interface RiskProvider {
  /** May only raise risk. A lower answer is ignored. */
  assess(effect: Readonly<Effect>): Promise<RiskLevel> | RiskLevel;
}

export interface ReceiptSink {
  write(receipt: GovernanceReceipt): Promise<void> | void;
}

export interface AuditEvent {
  type: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export type ReceiptPhase = "DECIDED" | "AUTHORIZED" | "COMPLETED" | "FAILED";

export interface GovernanceReceipt {
  receiptVersion: "1.0";
  receiptId: string;
  effectId: string;
  effectDigest: string | null;
  principalId: string;
  decision: GovernanceDecision;
  reasonCodes: string[];
  /** Governance returned ALLOW. */
  authorized: boolean;
  /** The protected callback was invoked. */
  attempted: boolean;
  /** The protected callback returned without throwing. This is the only claim that the effect happened. */
  occurred: boolean;
  phase: ReceiptPhase;
  evaluatedAt: string;
  policyVersion: string;
  metadata: Record<string, unknown>;
  /** Tamper-evidence only (unkeyed sha256). NOT a signature and not proof of origin. */
  integrity: { algorithm: "sha256"; digest: string };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface GovernanceResult {
  decision: GovernanceDecision;
  reasonCodes: string[];
  effectId: string;
  effectDigest: string | null;
  policyVersion: string;
  matchedRuleIds: string[];
  receipt?: GovernanceReceipt;
  /** True if the receipt could not be written to the configured sink. */
  receiptWriteFailed?: boolean;
  details?: string[];
}

export interface ExecutionResult<T> extends GovernanceResult {
  /** True only if the callback was invoked and returned without throwing. */
  executed: boolean;
  attempted: boolean;
  value?: T;
  error?: unknown;
  completionReceipt?: GovernanceReceipt;
}
