# MCP

`@senscheck/governance-mcp` governs tools of an MCP server built with `@modelcontextprotocol/sdk`. It does not import the SDK; it wraps the `registerTool` callback structurally. This is in-process governance for your own server, not a hosted gateway or multiplexer.

```
Agent -> MCP request -> governed handler -> canonical effect -> policy -> authority -> approval -> original tool
```

```ts
const governed = governMcpServer(server, {
  governance, principal: { id: "mcp-client", type: "agent" }, serverName: "notes",
  classify: { read_note: "READ_ONLY", add_note: "MUTATING", wipe_notes: "DESTRUCTIVE" },
});
governed.registerTool("wipe_notes", { description, inputSchema: { confirm: z.boolean() } }, handler);
```

Also: `governMcpTool(toolDefinition, options)` and `createGovernedTool({ ..., toolClass }, options)` for plain tool definitions.

| Class | verb | risk | default needs approval? |
|---|---|---|---|
| READ_ONLY | READ | LOW | no; **passes through untouched, no receipts** (set `governReads: true` to govern) |
| MUTATING | MUTATE | MEDIUM | no (policy decides) |
| PRIVILEGED | PRIVILEGED | HIGH | yes |
| DESTRUCTIVE | DESTROY | CRITICAL | yes |
| EXTERNAL_EFFECT | EXTERNAL_EFFECT | HIGH | yes |

Resource: `mcp:<serverName>/<tool>`; parameters: the validated tool arguments. **Unclassified tools default to PRIVILEGED.** Tool-supplied annotations (`readOnlyHint`, ...) are self-reported and **ignored unless `trustAnnotations: true`**.

Behaviour: schemas, names and descriptions are preserved. A blocked call returns an MCP result with `isError: true` and a message naming the decision, reason codes and receipt id (the handler does not run); if human approval is needed the message says so. Handler errors propagate to the SDK as usual.

Limits: tools registered on the raw `McpServer` are not governed (keep it private); the deprecated `tool()` overloads are refused on the governed object; Core does not run an MCP endpoint, hold your keys, or multiplex servers. No management tool exists: publish/grant/approve actions are never exposed over MCP by this package.
