// Govern an MCP server's tools. Uses the official SDK with an in-memory transport (no network).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEffect } from "@senscheck/governance-core";
import { governMcpServer } from "@senscheck/governance-mcp";
import { agent, assert, build, human, line } from "../_shared.mjs";

const { governance, approvals } = build({
  version: 1,
  default: "FAIL_CLOSED",
  rules: [{ id: "allow-mcp", when: { resource: "mcp:notes/*" }, decision: "ALLOW" }],
});

const server = new McpServer({ name: "notes", version: "1.0.0" });
const governed = governMcpServer(server, {
  governance,
  principal: agent,
  serverName: "notes",
  classify: { read_note: "READ_ONLY", add_note: "MUTATING", wipe_notes: "DESTRUCTIVE" },
});
const notes = ["first"];
const text = (t) => ({ content: [{ type: "text", text: t }] });
governed.registerTool("read_note", { description: "Read notes", inputSchema: {} }, async () => text(notes.join(",")));
governed.registerTool("add_note", { description: "Add a note", inputSchema: { body: z.string() } }, async ({ body }) => (notes.push(body), text("added")));
governed.registerTool("wipe_notes", { description: "Delete all notes", inputSchema: { confirm: z.boolean() } }, async () => (notes.length = 0, text("wiped")));
governed.registerTool("mystery_tool", { description: "Unclassified", inputSchema: {} }, async () => text("ran"));

const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "agent", version: "1.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;

line("read_note (READ_ONLY)", await call("read_note"));
line("add_note (MUTATING)", await call("add_note", { body: "second" }));
line("wipe_notes (no approval)", (await call("wipe_notes", { confirm: true })).slice(0, 78) + "...");
assert(notes.length === 2, "notes must survive an unapproved wipe");
line("mystery_tool (unclassified)", (await call("mystery_tool")).slice(0, 78) + "...");

const digest = (await governance.evaluate(createEffect({ principal: agent, verb: "DESTROY", resource: "mcp:notes/wipe_notes", risk: "CRITICAL", parameters: { confirm: true } }))).effectDigest;
approvals.approve(digest, human);
line("wipe_notes (human approved)", await call("wipe_notes", { confirm: true }));
assert(notes.length === 0, "approved wipe should run");
