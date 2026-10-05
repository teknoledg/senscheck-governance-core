import { canonicalizeEffect, createEffect, effectDigest } from "./effect.js";
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

/** Build the effect for one call from the live arguments. Throws if any option callback throws. */
function buildEffect<A extends unknown[]>(governance: SensCheckGovernance, options: WrapOptions<A>, args: A) {
  const principal =
    typeof options.principal === "function" ? options.principal(...args) : (options.principal ?? governance.defaultPrincipal);
  return createEffect({
    principal: principal as Principal,
    verb: options.verb,
    resource: typeof options.resource === "function" ? options.resource(...args) : options.resource,
    risk: options.risk,
    parameters: options.parameters ? options.parameters(...args) : defaultParameters(args),
    metadata: options.metadata,
  });
}

/**
 * Wrap a function so every call goes through governance.
 * Resolves with the function's value on ALLOW; throws GovernanceBlockedError otherwise (the function does not run).
 * If building the effect itself throws, governance receives an invalid effect and fails closed.
 *
 * The function receives the caller's live arguments, not the frozen copy that was authorized. To close that gap the
 * effect is rebuilt from those arguments synchronously, immediately before the call, and must hash to the authorized
 * digest; if an argument was mutated while governance was deciding, the function does not run.
 */
export function wrapFunction<A extends unknown[], R>(
  governance: SensCheckGovernance,
  fn: (...args: A) => R | Promise<R>,
  options: WrapOptions<A>,
): (...args: A) => Promise<Awaited<R>> {
  return async (...args: A): Promise<Awaited<R>> => {
    let effectInput: unknown;
    try {
      effectInput = buildEffect(governance, options, args);
    } catch {
      effectInput = undefined; // engine turns this into FAIL_CLOSED / INVALID_EFFECT with a receipt
    }
    const result = await governance.execute(effectInput, (authorized) => {
      let current: ReturnType<typeof canonicalizeEffect>;
      try {
        current = canonicalizeEffect(buildEffect(governance, options, args));
      } catch {
        throw new Error("SensCheck: call arguments could not be re-verified; the function did not run");
      }
      if (!current.ok || current.canonical.digest !== effectDigest(authorized)) {
        throw new Error("SensCheck: call arguments changed after authorization; the function did not run");
      }
      return fn(...args);
    });
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
