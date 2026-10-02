import { wrapFunction, type Principal, type RiskLevel, type SensCheckGovernance } from "@senscheck/governance-core";

/**
 * Structural shape of an OpenAI-style function tool: a name, optional description/parameters, and an
 * `execute(input, ...rest)` function (the shape produced by the `tool()` helper of the OpenAI Agents SDK).
 * This package does not import the OpenAI SDK, so it cannot break when that SDK changes; it only
 * replaces `execute` and returns every other field untouched.
 */
export interface FunctionToolLike {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (input: never, ...rest: never[]) => unknown;
  [key: string]: unknown;
}

export type OpenAIToolClass = "READ_ONLY" | "MUTATING" | "PRIVILEGED" | "DESTRUCTIVE" | "EXTERNAL_EFFECT";

const PROFILE: Record<OpenAIToolClass, { verb: string; risk: RiskLevel }> = {
  READ_ONLY: { verb: "READ", risk: "LOW" },
  MUTATING: { verb: "MUTATE", risk: "MEDIUM" },
  PRIVILEGED: { verb: "PRIVILEGED", risk: "HIGH" },
  DESTRUCTIVE: { verb: "DESTROY", risk: "CRITICAL" },
  EXTERNAL_EFFECT: { verb: "EXTERNAL_EFFECT", risk: "HIGH" },
};

export interface GovernToolOptions {
  governance: SensCheckGovernance;
  principal: Principal;
  /** Default PRIVILEGED for unclassified tools. */
  toolClass?: OpenAIToolClass;
}

/** The function-calling `execute` of the returned tool is governed. On a block it throws GovernanceBlockedError. */
export function governFunctionTool<T extends FunctionToolLike>(tool: T, options: GovernToolOptions): T {
  const { verb, risk } = PROFILE[options.toolClass ?? "PRIVILEGED"];
  const governed = wrapFunction(options.governance, tool.execute as (...a: unknown[]) => unknown, {
    principal: options.principal,
    verb,
    risk,
    resource: `tool:${tool.name}`,
    parameters: (input) => (input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : { input }),
  });
  return { ...tool, execute: governed };
}

/** Govern a list of tools with a per-name classification (unlisted tools default to PRIVILEGED). */
export function governFunctionTools<T extends FunctionToolLike>(
  tools: readonly T[],
  options: Omit<GovernToolOptions, "toolClass"> & { classes?: Record<string, OpenAIToolClass> },
): T[] {
  return tools.map((t) =>
    governFunctionTool(t, {
      governance: options.governance,
      principal: options.principal,
      toolClass: options.classes && Object.hasOwn(options.classes, t.name) ? options.classes[t.name] : "PRIVILEGED",
    }),
  );
}
