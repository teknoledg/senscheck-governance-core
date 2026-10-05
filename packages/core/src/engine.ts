import { LocalPolicyProvider } from "./policy/local.js";
import { canonicalizeEffect, isIsoTime, maxRisk, riskRank } from "./effect.js";
import { createReceipt, verifyReceipt, type ReceiptInput } from "./receipt.js";
import { MemoryReceiptSink } from "./providers/local.js";
import { ReasonCode } from "./reason-codes.js";
import { RISK_LEVELS } from "./types.js";
import type {
  ApprovalProvider,
  ApprovalResponse,
  AuditSink,
  AuthorityProvider,
  AuthorityResponse,
  CanonicalEffect,
  ContextProvider,
  Effect,
  ExecutionResult,
  GovernanceContext,
  GovernanceDecision,
  GovernanceReceipt,
  GovernanceResult,
  IdentityProvider,
  Principal,
  PolicyProvider,
  PolicyResult,
  ReceiptPhase,
  ReceiptSink,
  RiskLevel,
  RiskProvider,
} from "./types.js";
import { wrapFunction, wrapTool, type WrapOptions, type ToolLike } from "./wrap.js";

const CLOCK_SKEW_MS = 60_000;
const NON_AUTHORITY_TYPES = ["agent", "model", "llm", "ai", "assistant"];
const DECISIONS: readonly string[] = ["ALLOW", "DENY", "FAIL_CLOSED", "REQUIRE_APPROVAL"];

export interface GovernanceOptions {
  /** PolicyProvider instances, or plain policy config objects (wrapped in LocalPolicyProvider). */
  policies?: Array<PolicyProvider | object>;
  authorityProvider?: AuthorityProvider;
  approvalProvider?: ApprovalProvider;
  identityProvider?: IdentityProvider;
  contextProvider?: ContextProvider;
  riskProvider?: RiskProvider;
  receiptSink?: ReceiptSink;
  auditSink?: AuditSink;
  /** Per-provider-call timeout in ms. Default 2000. A timeout is FAIL_CLOSED, never ALLOW. */
  timeout?: number;
  /** Static environment name made available to policy (a ContextProvider value overrides it). */
  environment?: string;
  /** Principal used by wrapFunction/wrapTool when the wrapper does not name one. */
  defaultPrincipal?: Principal;
  /** Authority observedAt older than this is stale. Default 60000. */
  maxAuthorityAgeMs?: number;
  /** Approval older than this is stale. Default 900000. */
  maxApprovalAgeMs?: number;
  /** Max time between the decision and the callback. Default 30000. */
  maxDecisionAgeMs?: number;
  /** Optional: effects proposed longer ago than this are stale. */
  maxEffectAgeMs?: number;
  /** Risk at or above which independent human approval is required. Default "HIGH". "NONE" disables the risk gate. */
  approvalRiskThreshold?: RiskLevel | "NONE";
  /** Re-check authority immediately before effectuation. Default true. */
  recheckAuthority?: boolean;
  /** Single-use effectIds and approvalIds in execute(). Default true. */
  replayProtection?: boolean;
  /** Size of the in-memory replay cache. Default 10000. */
  replayCacheSize?: number;
  /** Injectable clock, for tests. */
  clock?: () => Date;
}

interface Decided extends GovernanceResult {
  principalId: string;
  canonical?: CanonicalEffect;
  decidedAtMs: number;
  authorityValidUntil?: number;
  approvalValidUntil?: number;
  approvalId?: string;
  /** Context the decision was made with; the authority recheck must see the same one. */
  context?: GovernanceContext;
  metadata: Record<string, unknown>;
}

type Checked<T> = { ok: true; value: T } | { ok: false; code: string };
type Blocked = { decision: GovernanceDecision; codes: string[]; details?: string[] };

const TIMED_OUT = Symbol("timeout");

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isIdPair(v: unknown): v is { id: string; type: string } {
  return isRecord(v) && typeof v["id"] === "string" && v["id"] !== "" && typeof v["type"] === "string" && v["type"] !== "";
}
function isPolicyResult(v: unknown): v is PolicyResult {
  return (
    isRecord(v) &&
    typeof v["decision"] === "string" &&
    DECISIONS.includes(v["decision"]) &&
    Array.isArray(v["reasonCodes"]) &&
    v["reasonCodes"].every((c) => typeof c === "string") &&
    (v["policyVersion"] === undefined || typeof v["policyVersion"] === "string") &&
    (v["matchedRuleIds"] === undefined ||
      (Array.isArray(v["matchedRuleIds"]) && v["matchedRuleIds"].every((c) => typeof c === "string")))
  );
}
function isAuthorityResponse(v: unknown): v is AuthorityResponse {
  return (
    isRecord(v) &&
    (v["status"] === "GRANTED" || v["status"] === "NOT_GRANTED") &&
    typeof v["principalId"] === "string" &&
    isIdPair(v["grantedBy"]) &&
    isIsoTime(v["observedAt"]) &&
    isIsoTime(v["expiresAt"]) &&
    (v["effectDigest"] === undefined || typeof v["effectDigest"] === "string")
  );
}
function isApprovalResponse(v: unknown): v is ApprovalResponse {
  if (!isRecord(v)) return false;
  if (v["status"] === "PENDING" || v["status"] === "REJECTED") return true;
  return (
    v["status"] === "APPROVED" &&
    isIdPair(v["approver"]) &&
    isIsoTime(v["approvedAt"]) &&
    typeof v["effectDigest"] === "string" &&
    (v["expiresAt"] === undefined || isIsoTime(v["expiresAt"])) &&
    (v["approvalId"] === undefined || typeof v["approvalId"] === "string")
  );
}
function isContext(v: unknown): v is GovernanceContext {
  return isRecord(v) && (v["environment"] === undefined || typeof v["environment"] === "string");
}
function isRisk(v: unknown): v is RiskLevel {
  return typeof v === "string" && (RISK_LEVELS as readonly string[]).includes(v);
}
function isIdentity(v: unknown): v is { verified: boolean } {
  return isRecord(v) && typeof v["verified"] === "boolean";
}
/** Providers must not see agent-influenced metadata: it is not covered by the digest. */
function withoutMetadata(effect: Readonly<Effect>): Readonly<Effect> {
  return Object.freeze({ ...effect, metadata: Object.freeze({}) });
}
function short(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 128) : "unknown";
}
function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export class SensCheckGovernance {
  private readonly policies: PolicyProvider[];
  private readonly authorityProvider?: AuthorityProvider;
  private readonly approvalProvider?: ApprovalProvider;
  private readonly identityProvider?: IdentityProvider;
  private readonly contextProvider?: ContextProvider;
  private readonly riskProvider?: RiskProvider;
  private readonly receiptSink: ReceiptSink;
  private readonly auditSink?: AuditSink;
  private readonly timeoutMs: number;
  private readonly environment?: string;
  readonly defaultPrincipal?: Principal;
  private readonly maxAuthorityAgeMs: number;
  private readonly maxApprovalAgeMs: number;
  private readonly maxDecisionAgeMs: number;
  private readonly maxEffectAgeMs?: number;
  private readonly approvalThreshold: number;
  private readonly recheckAuthority: boolean;
  private readonly replayProtection: boolean;
  private readonly replayCacheSize: number;
  private readonly clock: () => Date;
  private readonly consumedEffects = new Set<string>();
  private readonly consumedApprovals = new Set<string>();

  constructor(options: GovernanceOptions = {}) {
    const timeout = options.timeout ?? 2000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("timeout must be a positive number");
    this.timeoutMs = timeout;
    this.policies = (options.policies ?? []).map((p) =>
      typeof (p as PolicyProvider).evaluate === "function" ? (p as PolicyProvider) : new LocalPolicyProvider(p),
    );
    this.authorityProvider = options.authorityProvider;
    this.approvalProvider = options.approvalProvider;
    this.identityProvider = options.identityProvider;
    this.contextProvider = options.contextProvider;
    this.riskProvider = options.riskProvider;
    this.receiptSink = options.receiptSink ?? new MemoryReceiptSink();
    this.auditSink = options.auditSink;
    this.environment = options.environment;
    this.defaultPrincipal = options.defaultPrincipal;
    this.maxAuthorityAgeMs = options.maxAuthorityAgeMs ?? 60_000;
    this.maxApprovalAgeMs = options.maxApprovalAgeMs ?? 900_000;
    this.maxDecisionAgeMs = options.maxDecisionAgeMs ?? 30_000;
    this.maxEffectAgeMs = options.maxEffectAgeMs;
    const threshold = options.approvalRiskThreshold ?? "HIGH";
    this.approvalThreshold = threshold === "NONE" ? Number.POSITIVE_INFINITY : riskRank(threshold);
    this.recheckAuthority = options.recheckAuthority ?? true;
    this.replayProtection = options.replayProtection ?? true;
    this.replayCacheSize = options.replayCacheSize ?? 10_000;
    this.clock = options.clock ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Dry run. Runs the full pipeline, writes no receipt, consumes nothing. Never run an effect from this alone. */
  async evaluate(effect: unknown): Promise<GovernanceResult> {
    return this.toResult(await this.decide(effect));
  }

  /** Full pipeline plus a receipt. An ALLOW here is advisory: use execute() to act on it. */
  async authorize(effect: unknown): Promise<GovernanceResult> {
    const decided = await this.decide(effect);
    return this.record(decided, false);
  }

  /** Authorize, run the final gate, then (only on ALLOW) invoke the callback with the frozen canonical effect. */
  async execute<T>(effect: unknown, callback: (effect: Readonly<Effect>) => Promise<T> | T): Promise<ExecutionResult<T>> {
    let decided = await this.decide(effect);
    if (decided.decision !== "ALLOW" || decided.canonical === undefined) {
      return { ...(await this.record(decided, false)), executed: false, attempted: false };
    }
    const canonical = decided.canonical;

    // Final gate, async half: re-verify authority as late as practical.
    if (this.recheckAuthority) {
      const recheck = await this.checkAuthority(canonical, decided.context as GovernanceContext, this.clock());
      if (!recheck.ok) {
        decided = this.blocked(decided, {
          decision: recheck.blocked.decision,
          codes: [...recheck.blocked.codes, ReasonCode.FINAL_GATE_AUTHORITY_LOST],
        });
        return { ...(await this.record(decided, false)), executed: false, attempted: false };
      }
      decided.authorityValidUntil = recheck.validUntil;
    }

    // The ALLOW receipt is written BEFORE the effect. If it cannot be written, there is no effect.
    const allowed = await this.record(decided, false);
    if (allowed.decision !== "ALLOW") return { ...allowed, executed: false, attempted: false };

    // Final gate, synchronous half. No awaits between here and the callback invocation.
    const gate = this.finalGate(decided);
    if (gate !== undefined) {
      decided = this.blocked(decided, gate);
      return { ...(await this.record(decided, true)), executed: false, attempted: false };
    }

    let value: T | undefined;
    let error: unknown;
    let threw = false;
    try {
      value = await callback(canonical.effect);
    } catch (err) {
      threw = true;
      error = err;
    }

    const completion = createReceipt({
      effectId: decided.effectId,
      effectDigest: decided.effectDigest,
      principalId: decided.principalId,
      decision: "ALLOW",
      reasonCodes: [threw ? ReasonCode.CALLBACK_THREW : ReasonCode.EXECUTED],
      authorized: true,
      attempted: true,
      occurred: !threw,
      phase: threw ? "FAILED" : "COMPLETED",
      evaluatedAt: this.clock().toISOString(),
      policyVersion: decided.policyVersion,
      metadata: decided.metadata,
    });
    const completionWritten = await this.writeReceipt(completion);
    return {
      ...allowed,
      executed: !threw,
      attempted: true,
      value,
      error,
      completionReceipt: completion,
      ...(completionWritten ? {} : { receiptWriteFailed: true }),
    };
  }

  wrapFunction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, options: WrapOptions<A>) {
    return wrapFunction(this, fn, options);
  }

  wrapTool<T extends ToolLike>(tool: T, options: Omit<WrapOptions<unknown[]>, "resource"> & { resource?: WrapOptions<unknown[]>["resource"] }) {
    return wrapTool(this, tool, options);
  }

  createReceipt = createReceipt;
  verifyReceipt = verifyReceipt;

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  private baseContext(): GovernanceContext {
    return this.environment === undefined ? {} : { environment: this.environment };
  }

  private async decide(input: unknown): Promise<Decided> {
    try {
      return await this.decideUnsafe(input);
    } catch {
      return this.finish(
        {
          decision: "FAIL_CLOSED",
          reasonCodes: [ReasonCode.INTERNAL_ERROR],
          effectId: "unknown",
          effectDigest: null,
          principalId: "unknown",
          policyVersion: "none",
          matchedRuleIds: [],
        },
        new Date(),
      );
    }
  }

  private async decideUnsafe(input: unknown): Promise<Decided> {
    const now = this.clock();
    const parsed = canonicalizeEffect(input);
    if (!parsed.ok) {
      const raw = isRecord(input) ? input : {};
      const principal = isRecord(raw["principal"]) ? raw["principal"] : {};
      return this.finish(
        {
          decision: "FAIL_CLOSED",
          reasonCodes: [ReasonCode.INVALID_EFFECT],
          effectId: short(raw["effectId"]),
          effectDigest: null,
          principalId: short(principal["id"]),
          policyVersion: "none",
          matchedRuleIds: [],
          details: parsed.errors,
        },
        now,
      );
    }

    const canonical = parsed.canonical;
    const { digest } = canonical;
    // metadata is agent-influenced and not covered by the digest, so providers never see it: what an approver or
    // policy is shown is exactly what the digest binds. (It is still recorded in receipts via `base.metadata`.)
    const effect = withoutMetadata(canonical.effect);
    const base = {
      effectId: effect.effectId,
      effectDigest: digest,
      principalId: effect.principal.id,
      policyVersion: "none",
      matchedRuleIds: [] as string[],
      canonical,
      metadata: { verb: effect.action.verb, resource: effect.action.resource, declaredRisk: effect.risk } as Record<string, unknown>,
    };
    const stop = (blocked: Blocked, extra: Partial<Decided> = {}): Decided =>
      this.finish({ ...base, ...extra, decision: blocked.decision, reasonCodes: blocked.codes, details: blocked.details }, now);

    if (this.maxEffectAgeMs !== undefined) {
      const age = now.getTime() - Date.parse(effect.proposedAt);
      if (age > this.maxEffectAgeMs || age < -CLOCK_SKEW_MS) {
        return stop({ decision: "FAIL_CLOSED", codes: [ReasonCode.STALE_EFFECT] });
      }
    }

    if (this.replayProtection && this.consumedEffects.has(effect.effectId)) {
      return stop({ decision: "FAIL_CLOSED", codes: [ReasonCode.REPLAYED_EFFECT] });
    }

    // Identity
    if (this.identityProvider !== undefined) {
      const identity = this.identityProvider;
      const r = await this.checked(() => identity.verify(effect.principal), isIdentity, "IDENTITY");
      if (!r.ok) return stop({ decision: "FAIL_CLOSED", codes: [r.code] });
      if (!r.value.verified) return stop({ decision: "DENY", codes: [ReasonCode.IDENTITY_NOT_VERIFIED] });
    }

    // Context
    let context = this.baseContext();
    if (this.contextProvider !== undefined) {
      const provider = this.contextProvider;
      const r = await this.checked(() => provider.getContext(effect), isContext, "CONTEXT");
      if (!r.ok) return stop({ decision: "FAIL_CLOSED", codes: [r.code] });
      context = { ...context, ...r.value };
    }

    // Risk: providers may only raise it.
    let effectiveRisk: RiskLevel = effect.risk;
    if (this.riskProvider !== undefined) {
      const provider = this.riskProvider;
      const r = await this.checked(() => provider.assess(effect), isRisk, "RISK_PROVIDER");
      if (!r.ok) return stop({ decision: "FAIL_CLOSED", codes: [r.code] });
      effectiveRisk = maxRisk(effectiveRisk, r.value);
    }
    base.metadata["effectiveRisk"] = effectiveRisk;

    // Policy
    if (this.policies.length === 0) {
      return stop({ decision: "FAIL_CLOSED", codes: [ReasonCode.NO_POLICY_PROVIDER] });
    }
    const results: PolicyResult[] = [];
    const versions: string[] = [];
    for (const provider of this.policies) {
      const r = await this.checked(
        () => provider.evaluate({ effect, effectiveRisk, effectDigest: digest, context, now }),
        isPolicyResult,
        "POLICY",
      );
      if (!r.ok) return stop({ decision: "FAIL_CLOSED", codes: [r.code] }, { policyVersion: versions.join(",") || "none" });
      results.push(r.value);
      versions.push(`${provider.id}@${r.value.policyVersion ?? "unversioned"}`);
    }
    const policy = this.combine(results);
    const policyVersion = versions.join(",");
    const matched = unique(results.flatMap((r) => r.matchedRuleIds ?? []));
    base.policyVersion = policyVersion;
    base.matchedRuleIds = matched;
    if (policy.decision === "DENY" || policy.decision === "FAIL_CLOSED") return stop(policy);

    // Authority
    const authority = await this.checkAuthority(canonical, context, now);
    if (!authority.ok) return stop(authority.blocked);
    const codes = [...policy.codes, ReasonCode.AUTHORITY_VERIFIED];

    // Approval
    const requiredByPolicy = policy.decision === "REQUIRE_APPROVAL";
    const requiredByRisk = riskRank(effectiveRisk) >= this.approvalThreshold;
    let approvalValidUntil: number | undefined;
    let approvalId: string | undefined;
    if (requiredByPolicy || requiredByRisk) {
      const why = [
        ...(requiredByPolicy ? [ReasonCode.POLICY_REQUIRES_APPROVAL] : []),
        ...(requiredByRisk ? [ReasonCode.RISK_REQUIRES_APPROVAL] : []),
      ];
      const approval = await this.checkApproval(canonical, context, now, why);
      if (!approval.ok) return stop(approval.blocked, { authorityValidUntil: authority.validUntil });
      approvalValidUntil = approval.validUntil;
      approvalId = approval.approvalId;
      codes.push(ReasonCode.APPROVAL_VERIFIED);
    }

    return this.finish(
      {
        ...base,
        decision: "ALLOW",
        reasonCodes: unique(codes),
        authorityValidUntil: authority.validUntil,
        approvalValidUntil,
        approvalId,
        context,
      },
      now,
    );
  }

  private combine(results: PolicyResult[]): Blocked & { decision: GovernanceDecision } {
    const decisions = new Set(results.map((r) => r.decision));
    const codes = unique(results.flatMap((r) => r.reasonCodes));
    if (decisions.has("FAIL_CLOSED")) return { decision: "FAIL_CLOSED", codes };
    if (decisions.has("ALLOW") && decisions.has("DENY")) {
      return { decision: "FAIL_CLOSED", codes: unique([ReasonCode.CONFLICTING_GOVERNANCE, ...codes]) };
    }
    if (decisions.has("DENY")) return { decision: "DENY", codes };
    if (decisions.has("REQUIRE_APPROVAL")) return { decision: "REQUIRE_APPROVAL", codes };
    return { decision: "ALLOW", codes };
  }

  private async checkAuthority(
    canonical: CanonicalEffect,
    context: GovernanceContext,
    now: Date,
  ): Promise<{ ok: true; validUntil: number } | { ok: false; blocked: Blocked }> {
    const provider = this.authorityProvider;
    if (provider === undefined) {
      return { ok: false, blocked: { decision: "FAIL_CLOSED", codes: [ReasonCode.NO_AUTHORITY_PROVIDER] } };
    }
    const { digest } = canonical;
    const effect = withoutMetadata(canonical.effect);
    const r = await this.checked(
      () => provider.check({ effect, effectDigest: digest, context }),
      isAuthorityResponse,
      "AUTHORITY",
    );
    const fail = (decision: GovernanceDecision, code: string): { ok: false; blocked: Blocked } => ({
      ok: false,
      blocked: { decision, codes: [code] },
    });
    if (!r.ok) return fail("FAIL_CLOSED", r.code);
    const a = r.value;
    if (a.status === "NOT_GRANTED") return fail("DENY", ReasonCode.AUTHORITY_NOT_GRANTED);
    if (a.principalId !== effect.principal.id) return fail("FAIL_CLOSED", ReasonCode.AUTHORITY_PRINCIPAL_MISMATCH);
    if (a.grantedBy.id === effect.principal.id || NON_AUTHORITY_TYPES.includes(a.grantedBy.type.toLowerCase())) {
      return fail("DENY", ReasonCode.SELF_AUTHORIZATION);
    }
    if (a.effectDigest !== undefined && a.effectDigest !== digest) {
      return fail("FAIL_CLOSED", ReasonCode.AUTHORITY_EFFECT_MISMATCH);
    }
    const nowMs = now.getTime();
    const observed = Date.parse(a.observedAt);
    const expires = Date.parse(a.expiresAt);
    if (observed > nowMs + CLOCK_SKEW_MS) return fail("FAIL_CLOSED", ReasonCode.AUTHORITY_MALFORMED_RESPONSE);
    if (expires <= nowMs || nowMs - observed > this.maxAuthorityAgeMs) return fail("FAIL_CLOSED", ReasonCode.STALE_AUTHORITY);
    return { ok: true, validUntil: expires };
  }

  private async checkApproval(
    canonical: CanonicalEffect,
    context: GovernanceContext,
    now: Date,
    why: string[],
  ): Promise<
    { ok: true; validUntil: number; approvalId: string | undefined } | { ok: false; blocked: Blocked }
  > {
    const provider = this.approvalProvider;
    const fail = (decision: GovernanceDecision, ...codes: string[]): { ok: false; blocked: Blocked } => ({
      ok: false,
      blocked: { decision, codes },
    });
    if (provider === undefined) return fail("REQUIRE_APPROVAL", ...why, ReasonCode.APPROVAL_REQUIRED);

    const { digest } = canonical;
    const effect = withoutMetadata(canonical.effect);
    const r = await this.checked(() => provider.check({ effect, effectDigest: digest, context }), isApprovalResponse, "APPROVAL");
    if (!r.ok) return fail("FAIL_CLOSED", r.code);
    const a = r.value;
    if (a.status === "REJECTED") return fail("DENY", ReasonCode.APPROVAL_REJECTED);
    if (a.status === "PENDING") return fail("REQUIRE_APPROVAL", ...why, ReasonCode.APPROVAL_PENDING);

    // APPROVED: shape guaranteed by isApprovalResponse.
    const approver = a.approver as { id: string; type: string };
    if (approver.id === effect.principal.id) return fail("DENY", ReasonCode.SELF_APPROVAL);
    if (approver.type !== "human") return fail("DENY", ReasonCode.NON_HUMAN_APPROVER);
    if (a.effectDigest !== digest) return fail("FAIL_CLOSED", ReasonCode.APPROVAL_EFFECT_MISMATCH);
    const nowMs = now.getTime();
    const approvedAt = Date.parse(a.approvedAt as string);
    if (approvedAt > nowMs + CLOCK_SKEW_MS) return fail("FAIL_CLOSED", ReasonCode.APPROVAL_MALFORMED_RESPONSE);
    const validUntil = Math.min(
      approvedAt + this.maxApprovalAgeMs,
      a.expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(a.expiresAt),
    );
    if (validUntil <= nowMs) return fail("FAIL_CLOSED", ReasonCode.STALE_APPROVAL);
    // An approval without an id is still single-use: key it by what identifies the grant.
    const approvalKey = a.approvalId ?? `anon:${digest}:${approver.id}:${a.approvedAt as string}`;
    if (this.replayProtection && this.consumedApprovals.has(approvalKey)) {
      return fail("FAIL_CLOSED", ReasonCode.REPLAYED_APPROVAL);
    }
    return { ok: true, validUntil, approvalId: approvalKey };
  }

  /** Last synchronous checks before the callback. Returns a Blocked if the effect must not run. */
  private finalGate(decided: Decided): Blocked | undefined {
    const nowMs = this.clock().getTime();
    if (nowMs - decided.decidedAtMs > this.maxDecisionAgeMs) {
      return { decision: "FAIL_CLOSED", codes: [ReasonCode.FINAL_GATE_DECISION_STALE] };
    }
    if (decided.authorityValidUntil !== undefined && nowMs >= decided.authorityValidUntil) {
      return { decision: "FAIL_CLOSED", codes: [ReasonCode.FINAL_GATE_AUTHORITY_LOST, ReasonCode.STALE_AUTHORITY] };
    }
    if (decided.approvalValidUntil !== undefined && nowMs >= decided.approvalValidUntil) {
      return { decision: "FAIL_CLOSED", codes: [ReasonCode.STALE_APPROVAL] };
    }
    if (this.replayProtection) {
      if (this.consumedEffects.has(decided.effectId)) {
        return { decision: "FAIL_CLOSED", codes: [ReasonCode.REPLAYED_EFFECT] };
      }
      if (decided.approvalId !== undefined && this.consumedApprovals.has(decided.approvalId)) {
        return { decision: "FAIL_CLOSED", codes: [ReasonCode.REPLAYED_APPROVAL] };
      }
      this.consume(this.consumedEffects, decided.effectId);
      if (decided.approvalId !== undefined) this.consume(this.consumedApprovals, decided.approvalId);
    }
    return undefined;
  }

  private consume(set: Set<string>, id: string): void {
    set.add(id);
    if (set.size > this.replayCacheSize) {
      const oldest = set.values().next().value as string;
      set.delete(oldest);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Run a provider call under timeout; classify errors, timeouts and malformed responses. */
  private async checked<T>(
    fn: () => unknown,
    guard: (v: unknown) => v is T,
    prefix: "IDENTITY" | "CONTEXT" | "RISK_PROVIDER" | "POLICY" | "AUTHORITY" | "APPROVAL",
  ): Promise<Checked<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs);
    });
    let outcome: Checked<T>;
    try {
      const value = await Promise.race([Promise.resolve().then(fn), timeout]);
      if (value === TIMED_OUT) outcome = { ok: false, code: `${prefix}_TIMEOUT` };
      else if (!guard(value)) outcome = { ok: false, code: `${prefix}_MALFORMED_RESPONSE` };
      else outcome = { ok: true, value };
    } catch {
      outcome = { ok: false, code: `${prefix}_ERROR` };
    }
    clearTimeout(timer);
    return outcome;
  }

  private finish(
    r: Omit<GovernanceResult, "receipt"> & { principalId: string; canonical?: CanonicalEffect; metadata?: Record<string, unknown> } & Partial<Decided>,
    now: Date,
  ): Decided {
    return { ...r, metadata: r.metadata ?? {}, decidedAtMs: now.getTime() } as Decided;
  }

  private blocked(decided: Decided, b: Blocked): Decided {
    return { ...decided, decision: b.decision, reasonCodes: unique(b.codes), details: b.details };
  }

  private toResult(d: Decided): GovernanceResult {
    return {
      decision: d.decision,
      reasonCodes: d.reasonCodes,
      effectId: d.effectId,
      effectDigest: d.effectDigest,
      policyVersion: d.policyVersion,
      matchedRuleIds: d.matchedRuleIds,
      ...(d.details === undefined ? {} : { details: d.details }),
    };
  }

  private async writeReceipt(receipt: GovernanceReceipt): Promise<boolean> {
    const sink = this.receiptSink;
    const r = await this.checked(async () => (await sink.write(receipt), true), (v): v is true => v === true, "POLICY");
    return r.ok;
  }

  /**
   * Emit the decision receipt. An ALLOW whose receipt cannot be written is downgraded to FAIL_CLOSED:
   * no receipt, no effect. `afterAllow` marks a block that happened after an ALLOW receipt was already written.
   */
  private async record(decided: Decided, afterAllow: boolean): Promise<GovernanceResult> {
    const receiptInput = (d: Decided): ReceiptInput => ({
        effectId: d.effectId,
        effectDigest: d.effectDigest,
        principalId: d.principalId,
        decision: d.decision,
        reasonCodes: d.reasonCodes,
        authorized: d.decision === "ALLOW",
        attempted: false,
        occurred: false,
        phase: d.decision === "ALLOW" ? "AUTHORIZED" : ("DECIDED" satisfies ReceiptPhase),
        evaluatedAt: new Date(d.decidedAtMs).toISOString(),
        policyVersion: d.policyVersion,
        metadata: { ...d.metadata, matchedRuleIds: d.matchedRuleIds, ...(afterAllow ? { blockedAfterAllowReceipt: true } : {}) },
    });
    const build = (d: Decided): GovernanceReceipt => createReceipt(receiptInput(d));

    let final = decided;
    let receipt = build(final);
    const written = await this.writeReceipt(receipt);
    if (!written && final.decision === "ALLOW") {
      final = this.blocked(final, { decision: "FAIL_CLOSED", codes: [ReasonCode.RECEIPT_SINK_FAILURE] });
      // The failed write may still land later (e.g. it timed out). Name the receipt this one overrides so an
      // auditor never has to guess which of two receipts for one effect is true.
      const superseded = receipt.receiptId;
      receipt = createReceipt({ ...receiptInput(final), metadata: { ...receiptInput(final).metadata, supersedesReceiptId: superseded } });
      await this.writeReceipt(receipt); // best effort
    }
    if (this.auditSink !== undefined) {
      const audit = this.auditSink;
      await this.checked(
        async () => (await audit.record({ type: "governance.decision", at: receipt.evaluatedAt, detail: { receiptId: receipt.receiptId, decision: final.decision } }), true),
        (v): v is true => v === true,
        "POLICY",
      );
    }
    return { ...this.toResult(final), receipt, ...(written ? {} : { receiptWriteFailed: true }) };
  }
}
