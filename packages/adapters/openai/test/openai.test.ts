import { describe, expect, it, vi } from "vitest";
import { GovernanceBlockedError, MemoryReceiptSink, SensCheckGovernance, StaticAuthorityProvider, type PolicyConfig } from "@senscheck/governance-core";
import { governFunctionTool, governFunctionTools } from "@senscheck/governance-openai";

const principal = { id: "agent-1", type: "agent" as const };
const allow: PolicyConfig = { version: 1, default: "DENY", rules: [{ id: "all", when: { resource: "tool:*" }, decision: "ALLOW" }] };
const gov = () =>
  new SensCheckGovernance({
    policies: [allow],
    authorityProvider: new StaticAuthorityProvider([{ principalId: principal.id, verbs: ["*"], resources: ["*"], expiresAt: new Date(Date.now() + 3_600_000).toISOString(), grantedBy: { id: "admin", type: "human" } }]),
    receiptSink: new MemoryReceiptSink(),
  });

describe("governFunctionTool", () => {
  it("preserves tool fields, governs execute, and defaults to PRIVILEGED (approval needed)", async () => {
    const execute = vi.fn(async (_i: { q: string }) => "r");
    const tool = { type: "function", name: "search", description: "d", parameters: { type: "object" }, strict: true, execute };
    const g = governFunctionTool(tool, { governance: gov(), principal });
    expect(g).toMatchObject({ type: "function", name: "search", description: "d", strict: true, parameters: { type: "object" } });
    await expect(g.execute({ q: "x" })).rejects.toBeInstanceOf(GovernanceBlockedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs when classified MUTATING, including non-object input", async () => {
    const execute = vi.fn(async (_i: unknown) => "r");
    const g = governFunctionTool({ name: "t", execute }, { governance: gov(), principal, toolClass: "MUTATING" });
    expect(await g.execute({ a: 1 } as never)).toBe("r");
    expect(await g.execute("str" as never)).toBe("r");
    expect(await g.execute([1] as never)).toBe("r");
  });

  it("governFunctionTools applies per-name classes", async () => {
    const mk = (name: string) => ({ name, execute: vi.fn(async (_i?: unknown) => name) });
    const [a, b] = governFunctionTools([mk("read"), mk("wipe")], { governance: gov(), principal, classes: { read: "MUTATING" } });
    expect(await a!.execute(undefined as never)).toBe("read");
    await expect(b!.execute(undefined as never)).rejects.toMatchObject({ decision: "REQUIRE_APPROVAL" });
    const [c] = governFunctionTools([mk("x")], { governance: gov(), principal });
    await expect(c!.execute(undefined as never)).rejects.toMatchObject({ decision: "REQUIRE_APPROVAL" });
  });
});
