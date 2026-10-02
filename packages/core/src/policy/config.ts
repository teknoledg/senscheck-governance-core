import { RISK_LEVELS, PRINCIPAL_TYPES, type RiskLevel, type PrincipalType } from "../types.js";

export type RuleDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyCondition {
  verb?: string | string[];
  resource?: string | string[];
  principalId?: string | string[];
  principalType?: PrincipalType | PrincipalType[];
  risk?: RiskLevel | RiskLevel[];
  riskAtLeast?: RiskLevel;
  environment?: string | string[];
  time?: { notBefore?: string; notAfter?: string; hoursUtc?: { from: number; to: number } };
}

export interface PolicyRule {
  id: string;
  description?: string;
  when: PolicyCondition;
  /** Narrows an ALLOW rule. Not permitted on DENY / REQUIRE_APPROVAL rules (it would widen them). */
  except?: PolicyCondition;
  decision: RuleDecision;
}

export interface PolicyConfig {
  version: 1;
  /** What happens when no rule matches. ALLOW is not a valid default. */
  default: "DENY" | "FAIL_CLOSED";
  policyVersion?: string;
  verbAllowlist?: string[];
  resourceAllowlist?: string[];
  resourceDenylist?: string[];
  rules: PolicyRule[];
}

export type ConfigValidation =
  | { valid: true; config: PolicyConfig }
  | { valid: false; errors: string[] };

const CONFIG_KEYS = new Set([
  "$schema",
  "version",
  "default",
  "policyVersion",
  "verbAllowlist",
  "resourceAllowlist",
  "resourceDenylist",
  "rules",
]);
const RULE_KEYS = new Set(["id", "description", "when", "except", "decision"]);
const COND_KEYS = new Set([
  "verb",
  "resource",
  "principalId",
  "principalType",
  "risk",
  "riskAtLeast",
  "environment",
  "time",
]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0);
}

function stringOrList(v: unknown): boolean {
  return (typeof v === "string" && v.length > 0) || isStringList(v);
}

function enumOrList(v: unknown, allowed: readonly string[]): boolean {
  const list = Array.isArray(v) ? v : [v];
  return list.length > 0 && list.every((x) => typeof x === "string" && allowed.includes(x));
}

function validateTime(time: unknown, path: string, errors: string[]): void {
  if (!isRecord(time)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of Object.keys(time)) {
    if (key !== "notBefore" && key !== "notAfter" && key !== "hoursUtc") errors.push(`${path}.${key} unknown`);
  }
  if (Object.keys(time).length === 0) errors.push(`${path} must not be empty`);
  for (const key of ["notBefore", "notAfter"] as const) {
    const v = time[key];
    if (v !== undefined && !(typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
      errors.push(`${path}.${key} must be an ISO-8601 timestamp`);
    }
  }
  const hours = time["hoursUtc"];
  if (hours !== undefined) {
    const ok =
      isRecord(hours) &&
      Object.keys(hours).length === 2 &&
      Number.isInteger(hours["from"]) &&
      Number.isInteger(hours["to"]) &&
      (hours["from"] as number) >= 0 &&
      (hours["from"] as number) <= 23 &&
      (hours["to"] as number) >= 0 &&
      (hours["to"] as number) <= 23;
    if (!ok) errors.push(`${path}.hoursUtc must be {from,to} integers 0-23`);
  }
}

function validateCondition(cond: unknown, path: string, errors: string[]): void {
  if (!isRecord(cond)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const keys = Object.keys(cond);
  if (keys.length === 0) errors.push(`${path} must not be empty (use "*" explicitly)`);
  for (const key of keys) {
    if (!COND_KEYS.has(key)) errors.push(`${path}.${key} unknown`);
  }
  for (const key of ["verb", "resource", "principalId", "environment"] as const) {
    if (cond[key] !== undefined && !stringOrList(cond[key])) errors.push(`${path}.${key} must be a string or string list`);
  }
  if (cond["principalType"] !== undefined && !enumOrList(cond["principalType"], PRINCIPAL_TYPES)) {
    errors.push(`${path}.principalType invalid`);
  }
  if (cond["risk"] !== undefined && !enumOrList(cond["risk"], RISK_LEVELS)) errors.push(`${path}.risk invalid`);
  if (
    cond["riskAtLeast"] !== undefined &&
    !(typeof cond["riskAtLeast"] === "string" && (RISK_LEVELS as readonly string[]).includes(cond["riskAtLeast"]))
  ) {
    errors.push(`${path}.riskAtLeast invalid`);
  }
  if (cond["time"] !== undefined) validateTime(cond["time"], `${path}.time`, errors);
}

/** Strict validation. Any problem makes the whole config invalid: there is no partial or lenient load. */
export function validatePolicyConfig(input: unknown): ConfigValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ["config must be an object"] };

  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }
  if (input["version"] !== 1) errors.push("version must be 1");
  if (input["default"] !== "DENY" && input["default"] !== "FAIL_CLOSED") {
    errors.push("default must be DENY or FAIL_CLOSED (ALLOW is not a valid default)");
  }
  if (input["policyVersion"] !== undefined && (typeof input["policyVersion"] !== "string" || input["policyVersion"] === "")) {
    errors.push("policyVersion must be a non-empty string");
  }
  for (const key of ["verbAllowlist", "resourceAllowlist", "resourceDenylist"] as const) {
    if (input[key] !== undefined && !isStringList(input[key])) errors.push(`${key} must be a non-empty string list`);
  }

  const rules = input["rules"];
  if (!Array.isArray(rules)) {
    errors.push("rules must be an array");
  } else {
    const ids = new Set<string>();
    rules.forEach((rule: unknown, i) => {
      const path = `rules[${i}]`;
      if (!isRecord(rule)) {
        errors.push(`${path} must be an object`);
        return;
      }
      for (const key of Object.keys(rule)) {
        if (!RULE_KEYS.has(key)) errors.push(`${path}.${key} unknown`);
      }
      const id = rule["id"];
      if (typeof id !== "string" || id === "") {
        errors.push(`${path}.id must be a non-empty string`);
      } else if (ids.has(id)) {
        errors.push(`${path}.id duplicate: ${id}`);
      } else {
        ids.add(id);
      }
      const decision = rule["decision"];
      if (decision !== "ALLOW" && decision !== "DENY" && decision !== "REQUIRE_APPROVAL") {
        errors.push(`${path}.decision must be ALLOW, DENY or REQUIRE_APPROVAL`);
      }
      validateCondition(rule["when"], `${path}.when`, errors);
      if (rule["except"] !== undefined) {
        if (decision !== "ALLOW") errors.push(`${path}.except is only permitted on ALLOW rules`);
        validateCondition(rule["except"], `${path}.except`, errors);
      }
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, config: structuredClone(input) as unknown as PolicyConfig };
}
