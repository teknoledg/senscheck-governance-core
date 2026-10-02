import { createEffect } from "./effect.js";
import { GovernanceBlockedError } from "./errors.js";
import type { SensCheckGovernance } from "./engine.js";
import type { Principal, RiskLevel } from "./types.js";

export interface WrapOptions<A extends unknown[]> {
  verb: string;
  resource: string | ((...args: A) => string);
  risk: RiskLevel;
  /** Fixed at wrap time or derived from trusted call context. Never derive it from model output. */
  principal?: Principal | ((...args: A) => Principal);
  /** Defaults to the single object argument, or `{ args }`. Must be JSON-serializable. */
  parameters?: (...args: A) => Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ToolLike {
  name: string;
  execute: (...args: never[]) => unknown;
}

function defaultParameters(args: unknown[]): Record<string, unknown> {
  const first = args[0];
  if (args.length === 1 && first !== null && typeof first === "object" && !Array.isArray(first)) {
    return first as Record<string, unknown>;
  }
  return { args };
}

/**
 * Wrap a function so every call goes through governance.
 * Resolves with the function's value on ALLOW; throws GovernanceBlockedError otherwise (the function does not run).
 * If building the effect itself throws, governance receives an invalid effect and fails closed.
 */
export function wrapFunction<A extends unknown[], R>(
  governance: SensCheckGovernance,
  fn: (...args: A) => R | Promise<R>,
  options: WrapOptions<A>,
): (...args: A) => Promise<Awaited<R>> {
  return async (...args: A): Promise<Awaited<R>> => {
    let effectInput: unknown;
    try {
      const principal =
        typeof options.principal === "function" ? options.principal(...args) : (options.principal ?? governance.defaultPrincipal);
      effectInput = createEffect({
        principal: principal as Principal,
        verb: options.verb,
        resource: typeof options.resource === "function" ? options.resource(...args) : options.resource,
        risk: options.risk,
        parameters: options.parameters ? options.parameters(...args) : defaultParameters(args),
        metadata: options.metadata,
      });
    } catch {
      effectInput = undefined; // engine turns this into FAIL_CLOSED / INVALID_EFFECT with a receipt
    }
    const result = await governance.execute(effectInput, () => fn(...args));
    if (result.decision !== "ALLOW" || !result.attempted) throw new GovernanceBlockedError(result);
    if (!result.executed) throw result.error;
    return result.value as Awaited<R>;
  };
}

/** Return a copy of `tool` whose `execute` is governed. Resource defaults to `tool:<name>`. */
export function wrapTool<T extends ToolLike>(
  governance: SensCheckGovernance,
  tool: T,
  options: Omit<WrapOptions<unknown[]>, "resource"> & { resource?: WrapOptions<unknown[]>["resource"] },
): T {
  const governed = wrapFunction(governance, tool.execute as (...args: unknown[]) => unknown, {
    ...options,
    resource: options.resource ?? `tool:${tool.name}`,
  });
  return { ...tool, execute: governed };
}
