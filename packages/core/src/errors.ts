import type { ExecutionResult, GovernanceDecision, GovernanceResult } from "./types.js";

/** Thrown by wrapped functions when governance does not return ALLOW. The side effect did not run. */
export class GovernanceBlockedError extends Error {
  readonly decision: GovernanceDecision;
  readonly reasonCodes: string[];
  readonly result: GovernanceResult | ExecutionResult<unknown>;

  constructor(result: GovernanceResult | ExecutionResult<unknown>) {
    super(`SensCheck governance blocked the action: ${result.decision} (${result.reasonCodes.join(", ")})`);
    this.name = "GovernanceBlockedError";
    this.decision = result.decision;
    this.reasonCodes = result.reasonCodes;
    this.result = result;
  }
}
