import { ReasonCode, verifyReceipt, type GovernanceReceipt } from "@senscheck/governance-core";

const EXPLANATIONS: Record<string, string> = {
  [ReasonCode.INVALID_EFFECT]: "The proposed effect was missing or malformed, so nothing was inferred and the action was blocked.",
  [ReasonCode.STALE_EFFECT]: "The effect was proposed too long ago (or in the future).",
  [ReasonCode.NO_POLICY_PROVIDER]: "No policy was configured. Missing governance is never permission.",
  [ReasonCode.POLICY_ERROR]: "The policy provider threw an error.",
  [ReasonCode.POLICY_TIMEOUT]: "The policy provider did not answer in time.",
  [ReasonCode.POLICY_MALFORMED_RESPONSE]: "The policy provider returned something that was not a valid decision.",
  [ReasonCode.CONFLICTING_GOVERNANCE]: "Policy providers disagreed (ALLOW vs DENY). Disagreement fails closed.",
  [ReasonCode.NO_AUTHORITY_PROVIDER]: "No authority provider was configured, so nothing could verify that the principal holds authority.",
  [ReasonCode.AUTHORITY_ERROR]: "The authority provider threw an error.",
  [ReasonCode.AUTHORITY_TIMEOUT]: "The authority provider did not answer in time.",
  [ReasonCode.AUTHORITY_MALFORMED_RESPONSE]: "The authority provider returned an invalid response.",
  [ReasonCode.STALE_AUTHORITY]: "The authority had expired or had not been observed recently enough.",
  [ReasonCode.AUTHORITY_PRINCIPAL_MISMATCH]: "The authority was issued to a different principal.",
  [ReasonCode.AUTHORITY_EFFECT_MISMATCH]: "The authority was bound to a different effect.",
  [ReasonCode.AUTHORITY_NOT_GRANTED]: "The authority provider said the principal does not hold this authority.",
  [ReasonCode.SELF_AUTHORIZATION]: "The authority was granted by the agent itself (or an agent/model). Agents cannot authorize themselves.",
  [ReasonCode.SELF_APPROVAL]: "The approver was the proposing principal. Approval must be independent.",
  [ReasonCode.NON_HUMAN_APPROVER]: "The approver was not a human. Approval must come from an independent human.",
  [ReasonCode.APPROVAL_REQUIRED]: "Independent human approval is required and none could be requested (no approval provider).",
  [ReasonCode.APPROVAL_PENDING]: "Independent human approval is required and has not been given yet.",
  [ReasonCode.APPROVAL_REJECTED]: "A human rejected the approval.",
  [ReasonCode.APPROVAL_EFFECT_MISMATCH]: "The approval was for a different effect. Changing an effect requires fresh approval.",
  [ReasonCode.STALE_APPROVAL]: "The approval had expired.",
  [ReasonCode.APPROVAL_VERIFIED]: "A valid, independent, effect-bound human approval was verified.",
  [ReasonCode.POLICY_REQUIRES_APPROVAL]: "A policy rule requires human approval for this effect.",
  [ReasonCode.RISK_REQUIRES_APPROVAL]: "The risk level requires human approval.",
  [ReasonCode.POLICY_DENY]: "A policy rule denied this effect. Deny takes precedence over allow.",
  [ReasonCode.NO_MATCHING_RULE]: "No policy rule matched, so the default (never ALLOW) applied.",
  [ReasonCode.VERB_OUTSIDE_ALLOWLIST]: "The verb is not on the verb allowlist.",
  [ReasonCode.RESOURCE_OUTSIDE_ALLOWLIST]: "The resource is not on the resource allowlist.",
  [ReasonCode.RESOURCE_DENYLISTED]: "The resource is on the denylist.",
  [ReasonCode.IDENTITY_NOT_VERIFIED]: "The identity provider could not verify the principal.",
  [ReasonCode.RECEIPT_SINK_FAILURE]: "The ALLOW receipt could not be written, so the effect was blocked (no receipt, no effect).",
  [ReasonCode.REPLAYED_EFFECT]: "This effectId was already used. Effects are single-use.",
  [ReasonCode.REPLAYED_APPROVAL]: "This approval was already used. Approvals are single-use.",
  [ReasonCode.FINAL_GATE_DECISION_STALE]: "Too much time passed between the decision and the effect.",
  [ReasonCode.FINAL_GATE_AUTHORITY_LOST]: "Authority was lost or revoked between the decision and the effect.",
  [ReasonCode.AUTHORITY_VERIFIED]: "Fresh authority from a non-self source was verified.",
  [ReasonCode.POLICY_ALLOW]: "A policy rule allowed this effect.",
  [ReasonCode.EXECUTED]: "The protected callback ran and returned without throwing.",
  [ReasonCode.CALLBACK_THREW]: "The protected callback was invoked and threw. The effect may be partially applied.",
  [ReasonCode.INTERNAL_ERROR]: "An unexpected internal error occurred. Failing closed.",
};

export function explainReceipt(receipt: GovernanceReceipt): string {
  const v = verifyReceipt(receipt);
  const lines: string[] = [];
  lines.push(`Receipt ${receipt.receiptId}`);
  lines.push(`  principal : ${receipt.principalId}`);
  lines.push(`  effect    : ${receipt.effectId}${receipt.metadata["verb"] ? `  (${String(receipt.metadata["verb"])} ${String(receipt.metadata["resource"])})` : ""}`);
  lines.push(`  decision  : ${receipt.decision}   phase: ${receipt.phase}   at ${receipt.evaluatedAt}`);
  lines.push(`  lifecycle : authorized=${receipt.authorized}  attempted=${receipt.attempted}  occurred=${receipt.occurred}`);
  lines.push(`  policy    : ${receipt.policyVersion}`);
  lines.push("  why:");
  for (const code of receipt.reasonCodes) lines.push(`    - ${code}: ${EXPLANATIONS[code] ?? "(unrecognised reason code)"}`);
  lines.push(
    receipt.occurred
      ? "  meaning   : the protected action ran to completion."
      : receipt.attempted
        ? "  meaning   : the action was attempted but did not complete; it may be partially applied."
        : receipt.authorized
          ? "  meaning   : governance allowed it; no completion is recorded in this receipt."
          : "  meaning   : the action did NOT run.",
  );
  lines.push(
    v.valid
      ? "  integrity : digest matches (detects edits; this is NOT a signature and does not prove who wrote it)"
      : `  integrity : INVALID: ${v.errors.join("; ")}`,
  );
  return lines.join("\n");
}
