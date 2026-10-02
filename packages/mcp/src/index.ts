import { wrapFunction, type Principal, type RiskLevel, type SensCheckGovernance } from "@senscheck/governance-core";
import { GovernanceBlockedError } from "@senscheck/governance-core";

/** How a tool is treated. Anything not READ_ONLY is governed. */
export type McpToolClass = "READ_ONLY" | "MUTATING" | "PRIVILEGED" | "DESTRUCTIVE" | "EXTERNAL_EFFECT";

export const MCP_CLASS_PROFILE: Readonly<Record<McpToolClass, { verb: string; risk: RiskLevel }>> = {
  READ_ONLY: { verb: "READ", risk: "LOW" },
  MUTATING: { verb: "MUTATE", risk: "MEDIUM" },
  PRIVILEGED: { verb: "PRIVILEGED", risk: "HIGH" },
  DESTRUCTIVE: { verb: "DESTROY", risk: "CRITICAL" },
  EXTERNAL_EFFECT: { verb: "EXTERNAL_EFFECT", risk: "HIGH" },
};

export interface McpAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

export interface McpGovernOptions {
  governance: SensCheckGovernance;
  /** Who the MCP client acts as. Fixed by you, never taken from tool arguments. */
  principal: Principal;
  /** Used in the resource name `mcp:<serverName>/<tool>`. Default "mcp". */
  serverName?: string;
  /** Explicit classification: a map or a function. Wins over everything else. */
  classify?: Record<string, McpToolClass> | ((toolName: string) => McpToolClass | undefined);
  /** Class for tools you did not classify. Default PRIVILEGED (HIGH risk: needs human approval). */
  defaultClass?: McpToolClass;
  /**
   * Believe the tool's own annotations (readOnlyHint etc.). Default false: annotations are
   * self-reported by the server and are untrusted unless you say otherwise.
   */
  trustAnnotations?: boolean;
  /** Also govern READ_ONLY tools. Default false: reads pass through untouched, with no receipts. */
  governReads?: boolean;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function classifyMcpTool(name: string, options: McpGovernOptions, annotations?: McpAnnotations): McpToolClass {
  const { classify } = options;
  const explicit = typeof classify === "function" ? classify(name) : classify && Object.hasOwn(classify, name) ? classify[name] : undefined;
  if (explicit !== undefined) return explicit;
  if (options.trustAnnotations === true && annotations !== undefined) {
    if (annotations.destructiveHint === true) return "DESTRUCTIVE";
    if (annotations.readOnlyHint === true) return "READ_ONLY";
    if (annotations.openWorldHint === true) return "EXTERNAL_EFFECT";
  }
  return options.defaultClass ?? "PRIVILEGED";
}

export function blockedToolResult(err: GovernanceBlockedError): McpToolResult {
  const receiptId = err.result.receipt?.receiptId;
  const hint =
    err.decision === "REQUIRE_APPROVAL"
      ? " This action needs independent human approval. The agent cannot grant it; ask a human operator."
      : "";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `SensCheck governance blocked this tool call: ${err.decision} [${err.reasonCodes.join(", ")}]${receiptId ? ` receipt=${receiptId}` : ""}. The action did not run.${hint}`,
      },
    ],
  };
}

type Handler = (...args: never[]) => unknown;

function governHandler(
  name: string,
  handler: Handler,
  hasInput: boolean,
  annotations: McpAnnotations | undefined,
  options: McpGovernOptions,
): Handler {
  const toolClass = classifyMcpTool(name, options, annotations);
  if (toolClass === "READ_ONLY" && options.governReads !== true) return handler;

  const { verb, risk } = MCP_CLASS_PROFILE[toolClass];
  const governed = wrapFunction(
    options.governance,
    (...a: unknown[]) => (handler as (...x: unknown[]) => unknown)(...a),
    {
      verb,
      risk,
      resource: `mcp:${options.serverName ?? "mcp"}/${name}`,
      principal: options.principal,
      parameters: (...a: unknown[]) => (hasInput && isRecord(a[0]) ? a[0] : {}),
      metadata: { toolClass, protocol: "mcp" },
    },
  );
  return (async (...a: unknown[]) => {
    try {
      return await governed(...a);
    } catch (err) {
      if (err instanceof GovernanceBlockedError) return blockedToolResult(err);
      throw err;
    }
  }) as unknown as Handler;
}

export interface McpToolDefinition<H extends Handler = Handler> {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: McpAnnotations;
  handler: H;
  [key: string]: unknown;
}

/** Return a copy of a tool definition with a governed handler. Name, description and schemas are preserved verbatim. */
export function governMcpTool<T extends McpToolDefinition>(tool: T, options: McpGovernOptions): T {
  return {
    ...tool,
    handler: governHandler(tool.name, tool.handler, tool.inputSchema !== undefined, tool.annotations, options),
  };
}

/** Define a tool and govern it in one step, with an explicit class. */
export function createGovernedTool<T extends McpToolDefinition>(
  tool: T & { toolClass: McpToolClass },
  options: McpGovernOptions,
): T {
  const { toolClass, ...definition } = tool;
  const classify = (name: string) => (name === definition.name ? toolClass : typeof options.classify === "function" ? options.classify(name) : options.classify?.[name]);
  return governMcpTool(definition as unknown as T, { ...options, classify });
}

interface ServerLike {
  registerTool: (name: string, config: Record<string, unknown> & { inputSchema?: unknown; annotations?: McpAnnotations }, cb: Handler) => unknown;
  [key: string]: unknown;
}

/**
 * Wrap an McpServer (@modelcontextprotocol/sdk) so tools registered THROUGH THE RETURNED OBJECT are governed.
 * Tools registered on the original server object are not governed: keep the raw server private.
 * The deprecated `tool()` overloads are refused rather than silently left ungoverned.
 */
export function governMcpServer<S extends ServerLike>(server: S, options: McpGovernOptions): S {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, config: { inputSchema?: unknown; annotations?: McpAnnotations }, cb: Handler) =>
          target.registerTool(name, config, governHandler(name, cb, config.inputSchema !== undefined, config.annotations, options));
      }
      if (prop === "tool") {
        return () => {
          throw new Error("SensCheck: use registerTool() on a governed MCP server; tool() is not supported and would bypass governance.");
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
