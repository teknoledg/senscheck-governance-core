import {
  createEffect,
  MemoryReceiptSink,
  SensCheckGovernance,
  StaticApprovalProvider,
  StaticAuthorityProvider,
  type AuthorityResponse,
  type Effect,
  type GovernanceOptions,
  type PolicyConfig,
  type Principal,
  type PolicyProvider,
} from "@senscheck/governance-core";

export const T0 = Date.parse("2026-10-02T12:00:00.000Z");
export const agent: Principal = { id: "coding-agent", type: "agent" };
export const human = { id: "alice", type: "human" };

export class TestClock {
  constructor(public ms = T0) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function policyConfig(rules: PolicyConfig["rules"] = [], extra: Partial<PolicyConfig> = {}): PolicyConfig {
  return { version: 1, default: "FAIL_CLOSED", policyVersion: "t1", rules, ...extra };
}

export const allowAll: PolicyConfig = policyConfig([{ id: "allow-all", when: { resource: "*" }, decision: "ALLOW" }]);

export function effect(over: Partial<Parameters<typeof createEffect>[0]> = {}, clock = new TestClock()): Effect {
  return createEffect(
    { principal: agent, verb: "DELETE", resource: "file:/tmp/x", risk: "MEDIUM", ...over },
    clock.now(),
  );
}

export function grantAll(clock: TestClock, expiresInMs = 3_600_000): StaticAuthorityProvider {
  return new StaticAuthorityProvider(
    [
      {
        principalId: agent.id,
        verbs: ["*"],
        resources: ["*"],
        expiresAt: new Date(clock.ms + expiresInMs).toISOString(),
        grantedBy: { id: "admin", type: "human" },
      },
    ],
    clock.now,
  );
}

export function authResponse(clock: TestClock, over: Partial<AuthorityResponse> = {}): AuthorityResponse {
  return {
    status: "GRANTED",
    principalId: agent.id,
    grantedBy: { id: "admin", type: "human" },
    observedAt: new Date(clock.ms).toISOString(),
    expiresAt: new Date(clock.ms + 3_600_000).toISOString(),
    ...over,
  };
}

export interface Rig {
  gov: SensCheckGovernance;
  clock: TestClock;
  sink: MemoryReceiptSink;
  approvals: StaticApprovalProvider;
}

export function rig(over: Partial<GovernanceOptions> = {}, config: PolicyConfig = allowAll): Rig {
  const clock = new TestClock();
  const sink = new MemoryReceiptSink();
  const approvals = new StaticApprovalProvider(clock.now);
  const gov = new SensCheckGovernance({
    policies: [config],
    authorityProvider: grantAll(clock),
    approvalProvider: approvals,
    receiptSink: sink,
    clock: clock.now,
    timeout: 200,
    ...over,
  });
  return { gov, clock, sink, approvals };
}

export function policyReturning(result: unknown, id = "p"): PolicyProvider {
  return { id, evaluate: () => result as never };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
