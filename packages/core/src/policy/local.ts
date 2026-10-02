import { riskRank } from "../effect.js";
import { ReasonCode } from "../reason-codes.js";
import type { PolicyEvaluationInput, PolicyProvider, PolicyResult } from "../types.js";
import { validatePolicyConfig, type PolicyCondition, type PolicyConfig, type PolicyRule } from "./config.js";
import { globMatchAny } from "./glob.js";

/** true = matches, false = does not match, "unknown" = needed context was not available. */
type Tri = true | false | "unknown";

function list<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

function evalCondition(cond: PolicyCondition, input: PolicyEvaluationInput): Tri {
  let unknown = false;
  const { effect, effectiveRisk, context, now } = input;

  if (cond.verb !== undefined && !globMatchAny(cond.verb, effect.action.verb)) return false;
  if (cond.resource !== undefined && !globMatchAny(cond.resource, effect.action.resource)) return false;
  if (cond.principalId !== undefined && !globMatchAny(cond.principalId, effect.principal.id)) return false;
  if (cond.principalType !== undefined && !list(cond.principalType).includes(effect.principal.type)) return false;
  if (cond.risk !== undefined && !list(cond.risk).includes(effectiveRisk)) return false;
  if (cond.riskAtLeast !== undefined && riskRank(effectiveRisk) < riskRank(cond.riskAtLeast)) return false;

  if (cond.environment !== undefined) {
    if (typeof context.environment !== "string") unknown = true;
    else if (!globMatchAny(cond.environment, context.environment)) return false;
  }

  if (cond.time !== undefined) {
    const t = now.getTime();
    if (cond.time.notBefore !== undefined && t < Date.parse(cond.time.notBefore)) return false;
    if (cond.time.notAfter !== undefined && t >= Date.parse(cond.time.notAfter)) return false;
    if (cond.time.hoursUtc !== undefined) {
      const h = now.getUTCHours();
      const { from, to } = cond.time.hoursUtc;
      const inside = from <= to ? h >= from && h <= to : h >= from || h <= to;
      if (!inside) return false;
    }
  }
  return unknown ? "unknown" : true;
}

/**
 * Deterministic local policy. Precedence: constraints (allow/deny lists) > DENY > REQUIRE_APPROVAL > ALLOW > default.
 * Unknown context can only make a decision stricter: an ALLOW rule does not match on unknown context,
 * while DENY / REQUIRE_APPROVAL rules do.
 */
export class LocalPolicyProvider implements PolicyProvider {
  readonly id: string;
  private readonly config: PolicyConfig;

  constructor(config: unknown, id = "local-policy") {
    const result = validatePolicyConfig(config);
    if (!result.valid) {
      throw new Error(`Invalid SensCheck policy config: ${result.errors.join("; ")}`);
    }
    this.config = result.config;
    this.id = id;
  }

  evaluate(input: PolicyEvaluationInput): PolicyResult {
    const { effect } = input;
    const cfg = this.config;
    const policyVersion = cfg.policyVersion ?? "unversioned";

    if (cfg.resourceDenylist && globMatchAny(cfg.resourceDenylist, effect.action.resource)) {
      return { decision: "DENY", reasonCodes: [ReasonCode.RESOURCE_DENYLISTED], policyVersion, matchedRuleIds: [] };
    }
    if (cfg.verbAllowlist && !globMatchAny(cfg.verbAllowlist, effect.action.verb)) {
      return { decision: "DENY", reasonCodes: [ReasonCode.VERB_OUTSIDE_ALLOWLIST], policyVersion, matchedRuleIds: [] };
    }
    if (cfg.resourceAllowlist && !globMatchAny(cfg.resourceAllowlist, effect.action.resource)) {
      return {
        decision: "DENY",
        reasonCodes: [ReasonCode.RESOURCE_OUTSIDE_ALLOWLIST],
        policyVersion,
        matchedRuleIds: [],
      };
    }

    const denies: string[] = [];
    const approvals: string[] = [];
    const allows: string[] = [];
    for (const rule of cfg.rules) {
      if (this.applies(rule, input)) {
        (rule.decision === "DENY" ? denies : rule.decision === "REQUIRE_APPROVAL" ? approvals : allows).push(rule.id);
      }
    }

    if (denies.length > 0) {
      return { decision: "DENY", reasonCodes: [ReasonCode.POLICY_DENY], policyVersion, matchedRuleIds: denies };
    }
    if (approvals.length > 0) {
      return {
        decision: "REQUIRE_APPROVAL",
        reasonCodes: [ReasonCode.POLICY_REQUIRES_APPROVAL],
        policyVersion,
        matchedRuleIds: approvals,
      };
    }
    if (allows.length > 0) {
      return { decision: "ALLOW", reasonCodes: [ReasonCode.POLICY_ALLOW], policyVersion, matchedRuleIds: allows };
    }
    return { decision: cfg.default, reasonCodes: [ReasonCode.NO_MATCHING_RULE], policyVersion, matchedRuleIds: [] };
  }

  private applies(rule: PolicyRule, input: PolicyEvaluationInput): boolean {
    const when = evalCondition(rule.when, input);
    if (when === false) return false;
    if (rule.decision === "ALLOW") {
      if (when === "unknown") return false;
      if (rule.except !== undefined && evalCondition(rule.except, input) !== false) return false;
      return true;
    }
    return true; // DENY / REQUIRE_APPROVAL: unknown context matches (stricter)
  }
}
