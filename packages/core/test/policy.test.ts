import { describe, expect, it } from "vitest";
import { LocalPolicyProvider, ReasonCode as R, globMatch, validatePolicyConfig, type PolicyConfig, type PolicyEvaluationInput } from "@senscheck/governance-core";
import { effect, policyConfig, T0 } from "./helpers.js";

function input(over: Parameters<typeof effect>[0] = {}, extra: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  const e = effect(over);
  return { effect: e, effectDigest: "d", effectiveRisk: e.risk, context: {}, now: new Date(T0), ...extra };
}
const decide = (cfg: PolicyConfig, i: PolicyEvaluationInput) => new LocalPolicyProvider(cfg).evaluate(i);

describe("glob", () => {
  it("matches * ? and literals, escaping regex characters", () => {
    expect(globMatch("production:*", "production:api:eu")).toBe(true);
    expect(globMatch("file:/tmp/?.txt", "file:/tmp/a.txt")).toBe(true);
    expect(globMatch("file:/tmp/?.txt", "file:/tmp/ab.txt")).toBe(false);
    expect(globMatch("a.b", "aXb")).toBe(false);
    expect(globMatch("a+(b)", "a+(b)")).toBe(true);
    expect(globMatch("*", "multi\nline")).toBe(true);
  });
});

describe("LocalPolicyProvider (deterministic)", () => {
  it("deny beats approval beats allow beats default", () => {
    const cfg = policyConfig([
      { id: "a", when: { verb: "DELETE" }, decision: "ALLOW" },
      { id: "r", when: { resource: "file:*" }, decision: "REQUIRE_APPROVAL" },
      { id: "d", when: { resource: "file:/tmp/*" }, decision: "DENY" },
    ]);
    expect(decide(cfg, input()).decision).toBe("DENY");
    expect(decide(cfg, input({ resource: "file:/home/x" })).decision).toBe("REQUIRE_APPROVAL");
    expect(decide(cfg, input({ resource: "net:x", verb: "READ" })).decision).toBe("FAIL_CLOSED");
    expect(decide(cfg, input({ resource: "net:x", verb: "DELETE" })).decision).toBe("ALLOW");
    expect(decide({ ...cfg, default: "DENY" }, input({ resource: "net:x", verb: "READ" })).decision).toBe("DENY");
    expect(decide(cfg, input({ resource: "net:x", verb: "READ" })).reasonCodes).toEqual([R.NO_MATCHING_RULE]);
  });

  it("defaults policyVersion to 'unversioned'", () => {
    const { policyVersion: _v, ...cfg } = policyConfig();
    void _v;
    expect(decide(cfg as PolicyConfig, input()).policyVersion).toBe("unversioned");
  });

  it("allow/deny lists are constraints", () => {
    const base = policyConfig([{ id: "a", when: { resource: "*" }, decision: "ALLOW" }]);
    expect(decide({ ...base, resourceDenylist: ["file:/etc/*"] }, input({ resource: "file:/etc/passwd" })).reasonCodes).toEqual([R.RESOURCE_DENYLISTED]);
    expect(decide({ ...base, resourceDenylist: ["file:/etc/*"] }, input()).decision).toBe("ALLOW");
    expect(decide({ ...base, verbAllowlist: ["READ"] }, input()).reasonCodes).toEqual([R.VERB_OUTSIDE_ALLOWLIST]);
    expect(decide({ ...base, verbAllowlist: ["READ", "DELETE"] }, input()).decision).toBe("ALLOW");
    expect(decide({ ...base, resourceAllowlist: ["file:/srv/*"] }, input()).reasonCodes).toEqual([R.RESOURCE_OUTSIDE_ALLOWLIST]);
    expect(decide({ ...base, resourceAllowlist: ["file:/tmp/*"] }, input()).decision).toBe("ALLOW");
  });

  it("matches on principal, risk and riskAtLeast", () => {
    const rule = (when: object, decision: "DENY" | "ALLOW" = "DENY") => policyConfig([{ id: "r", when: when as never, decision }], { default: "DENY" });
    expect(decide(rule({ principalId: "coding-*" }), input()).decision).toBe("DENY");
    expect(decide(rule({ principalId: "other" }, "ALLOW"), input()).decision).toBe("DENY"); // default, rule did not match
    expect(decide(rule({ principalType: ["service", "agent"] }, "ALLOW"), input()).decision).toBe("ALLOW");
    expect(decide(rule({ principalType: "human" }, "ALLOW"), input()).matchedRuleIds).toEqual([]);
    expect(decide(rule({ risk: "MEDIUM" }, "ALLOW"), input()).decision).toBe("ALLOW");
    expect(decide(rule({ risk: ["LOW"] }, "ALLOW"), input()).matchedRuleIds).toEqual([]);
    expect(decide(rule({ riskAtLeast: "HIGH" }, "ALLOW"), input()).matchedRuleIds).toEqual([]);
    expect(decide(rule({ riskAtLeast: "MEDIUM" }, "ALLOW"), input()).decision).toBe("ALLOW");
  });

  it("uses the effective (raised) risk, not the declared risk", () => {
    const cfg = policyConfig([{ id: "r", when: { riskAtLeast: "HIGH" }, decision: "DENY" }], { default: "DENY" });
    expect(decide(cfg, input({ risk: "LOW" }, { effectiveRisk: "CRITICAL" })).matchedRuleIds).toEqual(["r"]);
  });

  it("environment conditions: match, mismatch, unknown", () => {
    const allow = policyConfig([{ id: "a", when: { environment: ["dev", "stag*"] }, decision: "ALLOW" }], { default: "DENY" });
    expect(decide(allow, input({}, { context: { environment: "staging" } })).decision).toBe("ALLOW");
    expect(decide(allow, input({}, { context: { environment: "production" } })).decision).toBe("DENY");
    expect(decide(allow, input()).decision).toBe("DENY"); // unknown: ALLOW does not apply
    const deny = policyConfig([{ id: "d", when: { environment: "production" }, decision: "DENY" }], { default: "FAIL_CLOSED" });
    expect(decide(deny, input()).decision).toBe("DENY"); // unknown: DENY applies (stricter)
    const approve = policyConfig([{ id: "q", when: { environment: "production" }, decision: "REQUIRE_APPROVAL" }]);
    expect(decide(approve, input()).decision).toBe("REQUIRE_APPROVAL");
  });

  it("time conditions", () => {
    const at = (iso: string) => ({ now: new Date(iso) });
    const win = policyConfig([{ id: "w", when: { time: { notBefore: "2026-10-02T09:00:00Z", notAfter: "2026-10-02T17:00:00Z" } }, decision: "ALLOW" }], { default: "DENY" });
    expect(decide(win, input({}, at("2026-10-02T12:00:00Z"))).decision).toBe("ALLOW");
    expect(decide(win, input({}, at("2026-10-02T08:00:00Z"))).decision).toBe("DENY");
    expect(decide(win, input({}, at("2026-10-02T17:00:00Z"))).decision).toBe("DENY");
    const hours = policyConfig([{ id: "h", when: { time: { hoursUtc: { from: 9, to: 17 } } }, decision: "ALLOW" }], { default: "DENY" });
    expect(decide(hours, input({}, at("2026-10-02T12:00:00Z"))).decision).toBe("ALLOW");
    expect(decide(hours, input({}, at("2026-10-02T20:00:00Z"))).decision).toBe("DENY");
    const overnight = policyConfig([{ id: "n", when: { time: { hoursUtc: { from: 22, to: 5 } } }, decision: "ALLOW" }], { default: "DENY" });
    expect(decide(overnight, input({}, at("2026-10-02T23:00:00Z"))).decision).toBe("ALLOW");
    expect(decide(overnight, input({}, at("2026-10-02T03:00:00Z"))).decision).toBe("ALLOW");
    expect(decide(overnight, input({}, at("2026-10-02T12:00:00Z"))).decision).toBe("DENY");
  });

  it("except narrows ALLOW and matches on other conditions", () => {
    const cfg = policyConfig(
      [{ id: "a", when: { resource: "file:*" }, except: { resource: "file:/etc/*" }, decision: "ALLOW" }],
      { default: "DENY" },
    );
    expect(decide(cfg, input({ resource: "file:/tmp/x" })).decision).toBe("ALLOW");
    expect(decide(cfg, input({ resource: "file:/etc/passwd" })).decision).toBe("DENY");
  });

  it("throws on invalid config rather than loading it", () => {
    expect(() => new LocalPolicyProvider({ nope: 1 })).toThrow(/Invalid SensCheck policy config/);
  });

  it("accepts a custom provider id", () => {
    expect(new LocalPolicyProvider(policyConfig(), "mine").id).toBe("mine");
  });
});

describe("policy config validation", () => {
  const ok = { version: 1, default: "DENY", rules: [{ id: "r", when: { verb: "DEPLOY" }, decision: "REQUIRE_APPROVAL" }] };

  it("accepts the documented example", () => {
    const r = validatePolicyConfig({
      version: 1,
      default: "FAIL_CLOSED",
      rules: [
        { id: "deny-production-delete", when: { verb: "DELETE", resource: "production:*" }, decision: "DENY" },
        { id: "approve-production-deploy", when: { verb: "DEPLOY", resource: "production:*" }, decision: "REQUIRE_APPROVAL" },
      ],
    });
    expect(r.valid).toBe(true);
  });

  const bad: Array<[string, unknown]> = [
    ["not an object", 5],
    ["array", []],
    ["unknown top key", { ...ok, extra: 1 }],
    ["wrong version", { ...ok, version: 2 }],
    ["default ALLOW", { ...ok, default: "ALLOW" }],
    ["missing default", { version: 1, rules: [] }],
    ["bad policyVersion", { ...ok, policyVersion: "" }],
    ["empty allowlist", { ...ok, resourceAllowlist: [] }],
    ["non-string in list", { ...ok, verbAllowlist: [1] }],
    ["rules not array", { ...ok, rules: {} }],
    ["rule not object", { ...ok, rules: ["x"] }],
    ["rule unknown key", { ...ok, rules: [{ id: "r", when: { verb: "X" }, decision: "DENY", extra: 1 }] }],
    ["rule id missing", { ...ok, rules: [{ when: { verb: "X" }, decision: "DENY" }] }],
    ["duplicate ids", { ...ok, rules: [{ id: "r", when: { verb: "X" }, decision: "DENY" }, { id: "r", when: { verb: "Y" }, decision: "DENY" }] }],
    ["bad decision", { ...ok, rules: [{ id: "r", when: { verb: "X" }, decision: "MAYBE" }] }],
    ["when missing", { ...ok, rules: [{ id: "r", decision: "DENY" }] }],
    ["when empty", { ...ok, rules: [{ id: "r", when: {}, decision: "DENY" }] }],
    ["when unknown key", { ...ok, rules: [{ id: "r", when: { colour: "red" }, decision: "DENY" }] }],
    ["when verb not string", { ...ok, rules: [{ id: "r", when: { verb: 5 }, decision: "DENY" }] }],
    ["bad principalType", { ...ok, rules: [{ id: "r", when: { principalType: "root" }, decision: "DENY" }] }],
    ["bad risk", { ...ok, rules: [{ id: "r", when: { risk: ["HUGE"] }, decision: "DENY" }] }],
    ["bad riskAtLeast", { ...ok, rules: [{ id: "r", when: { riskAtLeast: "HUGE" }, decision: "DENY" }] }],
    ["except on DENY", { ...ok, rules: [{ id: "r", when: { verb: "X" }, except: { verb: "Y" }, decision: "DENY" }] }],
    ["time not object", { ...ok, rules: [{ id: "r", when: { time: 5 }, decision: "ALLOW" }] }],
    ["time empty", { ...ok, rules: [{ id: "r", when: { time: {} }, decision: "ALLOW" }] }],
    ["time unknown key", { ...ok, rules: [{ id: "r", when: { time: { x: 1 } }, decision: "ALLOW" }] }],
    ["bad notBefore", { ...ok, rules: [{ id: "r", when: { time: { notBefore: "soon" } }, decision: "ALLOW" }] }],
    ["bad hoursUtc", { ...ok, rules: [{ id: "r", when: { time: { hoursUtc: { from: 0, to: 24 } } }, decision: "ALLOW" }] }],
    ["hoursUtc not object", { ...ok, rules: [{ id: "r", when: { time: { hoursUtc: 5 } }, decision: "ALLOW" }] }],
  ];
  it.each(bad)("rejects: %s", (_n, cfg) => {
    const r = validatePolicyConfig(cfg);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("returns a copy so later mutation of the source cannot change policy", () => {
    const src = structuredClone(ok);
    const r = validatePolicyConfig(src);
    src.default = "ALLOW";
    expect(r.valid && r.config.default).toBe("DENY");
  });
});
