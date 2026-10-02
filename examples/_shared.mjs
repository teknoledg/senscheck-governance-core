// Shared wiring for the examples. In a real app this lives in one module the agent cannot reconfigure.
import {
  MemoryReceiptSink,
  SensCheckGovernance,
  StaticApprovalProvider,
  StaticAuthorityProvider,
} from "@senscheck/governance-core";

export const agent = { id: "coding-agent", type: "agent" };
export const human = { id: "alice@example.com", type: "human" };

export function operatorAuthority() {
  return new StaticAuthorityProvider([
    {
      principalId: agent.id,
      verbs: ["*"],
      resources: ["*"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      grantedBy: { id: "ops-oncall", type: "human" },
    },
  ]);
}

export function build(policy, overrides = {}) {
  const approvals = new StaticApprovalProvider();
  const receipts = new MemoryReceiptSink();
  const governance = new SensCheckGovernance({
    policies: [policy],
    authorityProvider: operatorAuthority(),
    approvalProvider: approvals,
    receiptSink: receipts,
    defaultPrincipal: agent,
    timeout: 1000,
    ...overrides,
  });
  return { governance, approvals, receipts };
}

export const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
export function assert(cond, message) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}
