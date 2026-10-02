# @senscheck/governance-mcp

Govern MCP tools with [`@senscheck/governance-core`](https://www.npmjs.com/package/@senscheck/governance-core). Schemas are preserved; unclassified tools default to PRIVILEGED (human approval); tool annotations are untrusted unless you opt in; blocked calls return an MCP `isError` result.

```ts
import { governMcpServer } from "@senscheck/governance-mcp";
const governed = governMcpServer(server, {
  governance, principal: { id: "mcp-client", type: "agent" }, serverName: "notes",
  classify: { read_note: "READ_ONLY", wipe_notes: "DESTRUCTIVE" },
});
governed.registerTool("wipe_notes", { inputSchema: { confirm: z.boolean() } }, handler);
```

Also `governMcpTool()` and `createGovernedTool()`. Tools registered on the raw server are not governed; the deprecated `tool()` is refused on the governed object. See docs/mcp.md in the repository.
