import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MemoryReceiptSink,
  SensCheckGovernance,
  StaticApprovalProvider,
  StaticAuthorityProvider,
  type AuthorityProvider,
  type PolicyConfig,
} from "@senscheck/governance-core";
import { classifyMcpTool, createGovernedTool, governMcpServer, governMcpTool, type McpGovernOptions } from "@senscheck/governance-mcp";

const principal = { id: "mcp-agent", type: "agent" as const };
const human = { id: "alice", type: "human" };
const policy: PolicyConfig = { version: 1, default: "FAIL_CLOSED", rules: [{ id: "allow-mcp", when: { resource: "mcp:*" }, decision: "ALLOW" }] };

function setup(over: { authorityProvider?: AuthorityProvider; opts?: Partial<McpGovernOptions> } = {}) {
  const sink = new MemoryReceiptSink();
  const approvals = new StaticApprovalProvider();
  const gov = new SensCheckGovernance({
    policies: [policy],
    authorityProvider:
      over.authorityProvider ??
      new StaticAuthorityProvider([
        { principalId: principal.id, verbs: ["*"], resources: ["*"], expiresAt: new Date(Date.now() + 3_600_000).toISOString(), grantedBy: { id: "admin", type: "human" } },
      ]),
    approvalProvider: approvals,
    receiptSink: sink,
    timeout: 500,
  });
  const options: McpGovernOptions = { governance: gov, principal, serverName: "demo", ...over.opts };
  return { gov, sink, approvals, options };
}

async function connect(server: McpServer) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

describe("governMcpServer against the real MCP SDK", () => {
  it("passes READ_ONLY tools through untouched (no receipts) and preserves schemas", async () => {
    const { options, sink } = setup({ opts: { classify: { read_file: "READ_ONLY" } } });
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    const handler = vi.fn(async ({ path }: { path: string }) => ({ content: [{ type: "text" as const, text: `contents of ${path}` }] }));
    governed.registerTool("read_file", { description: "Read a file", inputSchema: { path: z.string() } }, handler);
    const client = await connect(server);

    const listed = await client.listTools();
    expect(listed.tools[0]?.name).toBe("read_file");
    expect(listed.tools[0]?.description).toBe("Read a file");
    expect(JSON.stringify(listed.tools[0]?.inputSchema)).toContain('"path"');

    const result = await client.callTool({ name: "read_file", arguments: { path: "/a" } });
    expect(text(result)).toBe("contents of /a");
    expect(sink.receipts).toHaveLength(0);
  });

  it("unknown tools default to PRIVILEGED: REQUIRE_APPROVAL, handler not run, MCP-shaped error", async () => {
    const { options } = setup();
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ran" }] }));
    governed.registerTool("do_thing", { inputSchema: { x: z.number() } }, handler);
    const client = await connect(server);
    const result = await client.callTool({ name: "do_thing", arguments: { x: 1 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("REQUIRE_APPROVAL");
    expect(text(result)).toContain("human");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a destructive tool runs only after independent human approval of that exact call", async () => {
    const { options, gov, approvals, sink } = setup({ opts: { classify: { delete_all: "DESTRUCTIVE" } } });
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "deleted" }] }));
    governed.registerTool("delete_all", { inputSchema: { dir: z.string() } }, handler);
    const client = await connect(server);

    const blocked = await client.callTool({ name: "delete_all", arguments: { dir: "/data" } });
    expect(blocked.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    // A human approves exactly this effect (same principal, resource, parameters, risk).
    const { createEffect } = await import("@senscheck/governance-core");
    const digest = (
      await gov.evaluate(createEffect({ principal, verb: "DESTROY", resource: "mcp:demo/delete_all", risk: "CRITICAL", parameters: { dir: "/data" } }))
    ).effectDigest!;
    approvals.approve(digest, human);

    const wrongArgs = await client.callTool({ name: "delete_all", arguments: { dir: "/" } });
    expect(wrongArgs.isError).toBe(true); // different parameters: approval does not carry over
    expect(handler).not.toHaveBeenCalled();

    const ok = await client.callTool({ name: "delete_all", arguments: { dir: "/data" } });
    expect(ok.isError).toBeFalsy();
    expect(text(ok)).toBe("deleted");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(sink.receipts.some((r) => r.phase === "COMPLETED" && r.occurred)).toBe(true);

    const replay = await client.callTool({ name: "delete_all", arguments: { dir: "/data" } });
    expect(replay.isError).toBe(true); // single-use approval
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("FAIL_CLOSED when the authority provider is down", async () => {
    const { options } = setup({ authorityProvider: { check: () => Promise.reject(new Error("offline")) }, opts: { classify: { write: "MUTATING" } } });
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ran" }] }));
    governed.registerTool("write", {}, handler);
    const client = await connect(server);
    const result = await client.callTool({ name: "write", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("FAIL_CLOSED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a MUTATING tool with no input schema runs when allowed (callback receives only `extra`)", async () => {
    const { options } = setup({ opts: { classify: { ping: "MUTATING" } } });
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    governed.registerTool("ping", {}, async () => ({ content: [{ type: "text" as const, text: "pong" }] }));
    const client = await connect(server);
    expect(text(await client.callTool({ name: "ping", arguments: {} }))).toBe("pong");
  });

  it("tool() is refused so nothing silently bypasses governance; other members still work", () => {
    const { options } = setup();
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer & { tool: () => void };
    expect(() => governed.tool()).toThrow(/registerTool/);
    expect(typeof governed.connect).toBe("function");
    expect((governed as unknown as { server: unknown }).server).toBeDefined();
  });

  it("handler errors propagate to the MCP SDK (which reports them as tool errors)", async () => {
    const { options } = setup({ opts: { classify: { boom: "MUTATING" } } });
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    const governed = governMcpServer(server as never, options) as unknown as McpServer;
    governed.registerTool("boom", {}, async () => {
      throw new Error("kaboom");
    });
    const client = await connect(server);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("kaboom");
  });

  it("documented limitation: a tool registered on the raw server is NOT governed", async () => {
    const { options } = setup();
    const server = new McpServer({ name: "demo", version: "1.0.0" });
    governMcpServer(server as never, options);
    server.registerTool("sneaky", {}, async () => ({ content: [{ type: "text" as const, text: "ungoverned" }] }));
    const client = await connect(server);
    expect(text(await client.callTool({ name: "sneaky", arguments: {} }))).toBe("ungoverned");
  });
});

describe("classification", () => {
  const base = (over: Partial<McpGovernOptions> = {}) => ({ ...setup().options, ...over });

  it("explicit map/function wins; unknown defaults to PRIVILEGED; defaultClass overrides", () => {
    expect(classifyMcpTool("a", base({ classify: { a: "READ_ONLY" } }))).toBe("READ_ONLY");
    expect(classifyMcpTool("b", base({ classify: (n) => (n === "b" ? "MUTATING" : undefined) }))).toBe("MUTATING");
    expect(classifyMcpTool("c", base({ classify: { a: "READ_ONLY" } }))).toBe("PRIVILEGED");
    expect(classifyMcpTool("d", base())).toBe("PRIVILEGED");
    expect(classifyMcpTool("e", base({ defaultClass: "EXTERNAL_EFFECT" }))).toBe("EXTERNAL_EFFECT");
    expect(classifyMcpTool("toString", base({ classify: {} }))).toBe("PRIVILEGED"); // prototype keys are not classifications
  });

  it("annotations are ignored unless trustAnnotations is set", () => {
    const lying = { readOnlyHint: true };
    expect(classifyMcpTool("x", base(), lying)).toBe("PRIVILEGED");
    expect(classifyMcpTool("x", base({ trustAnnotations: true }), lying)).toBe("READ_ONLY");
    expect(classifyMcpTool("x", base({ trustAnnotations: true }), { destructiveHint: true, readOnlyHint: true })).toBe("DESTRUCTIVE");
    expect(classifyMcpTool("x", base({ trustAnnotations: true }), { openWorldHint: true })).toBe("EXTERNAL_EFFECT");
    expect(classifyMcpTool("x", base({ trustAnnotations: true }), {})).toBe("PRIVILEGED");
  });
});

describe("governMcpTool / createGovernedTool", () => {
  it("governs a plain tool definition and keeps its schema", async () => {
    const { options } = setup({ opts: { classify: { echo: "MUTATING" } } });
    const schema = { type: "object", properties: { msg: { type: "string" } } };
    const tool = { name: "echo", description: "echo", inputSchema: schema, handler: async (a: { msg: string }) => ({ content: [{ type: "text" as const, text: a.msg }] }) };
    const governed = governMcpTool(tool as never, options) as typeof tool;
    expect(governed.inputSchema).toBe(schema);
    expect(text(await governed.handler({ msg: "hi" }))).toBe("hi");
  });

  it("governReads:true also governs reads", async () => {
    const { options, sink } = setup({ opts: { classify: { r: "READ_ONLY" }, governReads: true } });
    const tool = { name: "r", handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }) };
    const governed = governMcpTool(tool as never, options) as typeof tool;
    await governed.handler();
    expect(sink.receipts.length).toBeGreaterThan(0);
  });

  it("createGovernedTool applies the explicit class and keeps other classifications", async () => {
    const { options } = setup({ opts: { classify: (n) => (n === "other" ? "READ_ONLY" : undefined) } });
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ran" }] }));
    const tool = createGovernedTool({ name: "wipe", toolClass: "DESTRUCTIVE", handler }, options);
    expect(text(await tool.handler())).toContain("REQUIRE_APPROVAL");
    expect(handler).not.toHaveBeenCalled();
    const viaMap = createGovernedTool({ name: "wipe", toolClass: "READ_ONLY", handler }, { ...options, classify: { z: "READ_ONLY" } });
    expect(text(await viaMap.handler())).toBe("ran");
  });
});
