// Production deployment: proposal -> canonical effect -> policy -> approval -> execution -> receipt.
import { createEffect, verifyReceipt } from "@senscheck/governance-core";
import { agent, assert, build, human, line } from "../_shared.mjs";

const { governance, approvals, receipts } = build({
  version: 1,
  default: "FAIL_CLOSED",
  policyVersion: "deploy-policy-1",
  rules: [
    { id: "deny-production-delete", when: { verb: "DELETE", resource: "production:*" }, decision: "DENY" },
    { id: "approve-production-deploy", when: { verb: "DEPLOY", resource: "production:*" }, decision: "REQUIRE_APPROVAL" },
    { id: "allow-staging", when: { verb: "DEPLOY", resource: "staging:*" }, decision: "ALLOW" },
  ],
});

// 1. The model proposes (this is just a request, with no authority attached).
console.log('1. proposal: "ship api v2.3.1 to production"');

// 2. Canonical effect.
const effect = createEffect({
  principal: agent,
  verb: "DEPLOY",
  resource: "production:api",
  risk: "HIGH",
  parameters: { version: "2.3.1", region: "eu-west-1" },
});
console.log("2. canonical effect:", JSON.stringify(effect, null, 2));

// 3. Policy evaluation (dry run, no receipt).
const verdict = await governance.evaluate(effect);
line("3. policy evaluation", `${verdict.decision} [${verdict.reasonCodes.join(",")}] rules=${verdict.matchedRuleIds}`);
assert(verdict.decision === "REQUIRE_APPROVAL", "production deploy must require approval");

// 4. Without approval, nothing runs.
let deployed = 0;
const deploy = async (e) => {
  deployed++;
  return `deployed ${e.parameters.version} to ${e.action.resource}`;
};
const blocked = await governance.execute(effect, deploy);
line("4. execute without approval", `${blocked.decision}, deployed=${deployed}`);
assert(deployed === 0, "deploy must not run without approval");

// 5. A human approves THIS exact effect, through a channel the agent cannot reach.
approvals.approve(verdict.effectDigest, human);
line("5. approval recorded", `${human.id} for digest ${verdict.effectDigest.slice(0, 12)}...`);

// 6. Execution (note: it needs a fresh effectId to be a new proposal; same material fields = same approval digest).
const retry = createEffect({ principal: agent, verb: "DEPLOY", resource: "production:api", risk: "HIGH", parameters: effect.parameters });
const done = await governance.execute(retry, deploy);
line("6. execute with approval", `${done.decision}, executed=${done.executed}, value="${done.value}"`);
assert(done.executed && deployed === 1, "approved deploy must run exactly once");

// 7. Receipts.
console.log("7. receipts:");
for (const r of receipts.receipts) {
  line(`   ${r.phase}`, `decision=${r.decision} authorized=${r.authorized} attempted=${r.attempted} occurred=${r.occurred} integrity=${verifyReceipt(r).valid ? "ok" : "BAD"}`);
}
