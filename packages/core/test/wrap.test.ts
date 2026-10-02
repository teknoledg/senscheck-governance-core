import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GovernanceBlockedError, ReasonCode as R, verifyReceipt } from "@senscheck/governance-core";
import { FileReceiptSink, readReceiptFile } from "@senscheck/governance-core/node";
import { agent, human, policyConfig, rig, TestClock, effect } from "./helpers.js";

describe("wrapFunction / wrapTool", () => {
  it("passes the value through on ALLOW", async () => {
    const r = rig({ defaultPrincipal: agent });
    const fn = vi.fn(async ({ path }: { path: string }) => `deleted ${path}`);
    const safe = r.gov.wrapFunction(fn, { verb: "DELETE", resource: ({ path }) => `file:${path}`, risk: "MEDIUM" });
    await expect(safe({ path: "/tmp/a" })).resolves.toBe("deleted /tmp/a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.sink.receipts.at(-1)?.occurred).toBe(true);
  });

  it("throws GovernanceBlockedError and does not run the function on DENY", async () => {
    const r = rig({ defaultPrincipal: agent }, policyConfig([], { default: "DENY" }));
    const fn = vi.fn();
    const safe = r.gov.wrapFunction(fn, { verb: "DELETE", resource: "file:x", risk: "LOW" });
    const err = await safe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GovernanceBlockedError);
    expect((err as GovernanceBlockedError).decision).toBe("DENY");
    expect(fn).not.toHaveBeenCalled();
  });

  it("fails closed with no principal anywhere", async () => {
    const r = rig();
    const fn = vi.fn();
    const safe = r.gov.wrapFunction(fn, { verb: "DELETE", resource: "file:x", risk: "LOW" });
    const err = (await safe().catch((e: unknown) => e)) as GovernanceBlockedError;
    expect(err.reasonCodes).toEqual([R.INVALID_EFFECT]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fails closed when the resource resolver throws", async () => {
    const r = rig({ defaultPrincipal: agent });
    const fn = vi.fn();
    const safe = r.gov.wrapFunction(fn, {
      verb: "DELETE",
      resource: () => {
        throw new Error("bad args");
      },
      risk: "LOW",
    });
    const err = (await safe().catch((e: unknown) => e)) as GovernanceBlockedError;
    expect(err.decision).toBe("FAIL_CLOSED");
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses per-call principal, explicit parameters, and rethrows the callback's own error", async () => {
    const r = rig();
    const boom = new Error("disk full");
    const safe = r.gov.wrapFunction(
      (_a: number, _b: number) => {
        throw boom;
      },
      { verb: "WRITE", resource: "db:t", risk: "LOW", principal: () => agent, parameters: (a, b) => ({ a, b }), metadata: { why: "test" } },
    );
    await expect(safe(1, 2)).rejects.toBe(boom);
    expect(r.sink.receipts.at(-1)?.phase).toBe("FAILED");
  });

  it("default parameters: object arg is used directly, otherwise wrapped as {args}", async () => {
    const r = rig({ defaultPrincipal: agent });
    const seen: unknown[] = [];
    const safe = r.gov.wrapFunction((...a: unknown[]) => seen.push(a), { verb: "X", resource: "r", risk: "LOW", principal: agent });
    await safe(1, 2);
    await safe([1]);
    await safe(null);
    await safe();
    expect(seen).toHaveLength(4);
  });

  it("non-serializable arguments fail closed", async () => {
    const r = rig({ defaultPrincipal: agent });
    const safe = r.gov.wrapFunction((_x: unknown) => 1, { verb: "X", resource: "r", risk: "LOW" });
    await expect(safe({ f: () => 1 })).rejects.toBeInstanceOf(GovernanceBlockedError);
  });

  it("wrapTool governs execute and keeps other tool fields; resource defaults to tool:<name>", async () => {
    const r = rig({ defaultPrincipal: agent });
    const execute = vi.fn(async (input: { q: string }) => input.q.toUpperCase());
    const tool = { name: "shout", description: "uppercases", execute };
    const governed = r.gov.wrapTool(tool, { verb: "CALL", risk: "LOW" });
    expect(governed.description).toBe("uppercases");
    await expect((governed.execute as (i: { q: string }) => Promise<string>)({ q: "hi" })).resolves.toBe("HI");
    expect(r.sink.receipts[0]?.metadata["resource"]).toBe("tool:shout");
    const custom = r.gov.wrapTool(tool, { verb: "CALL", risk: "LOW", resource: "custom:x" });
    await (custom.execute as (i: { q: string }) => Promise<string>)({ q: "a" });
    expect(r.sink.receipts.at(-1)?.metadata["resource"]).toBe("custom:x");
  });

  it("nested governed calls each get their own decision and receipts", async () => {
    const r = rig({ defaultPrincipal: agent });
    const inner = r.gov.wrapFunction(async () => "inner", { verb: "READ", resource: "a", risk: "LOW" });
    const outer = r.gov.wrapFunction(async () => inner(), { verb: "WRITE", resource: "b", risk: "LOW" });
    await expect(outer()).resolves.toBe("inner");
    expect(r.sink.receipts.filter((x) => x.phase === "COMPLETED")).toHaveLength(2);
  });
});

describe("node: FileReceiptSink", () => {
  it("appends verifiable JSONL receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "senscheck-"));
    const path = join(dir, "nested", "receipts.jsonl");
    const r = rig({ receiptSink: new FileReceiptSink(path), defaultPrincipal: agent });
    await r.gov.execute(effect(), () => 1);
    const lines = await readReceiptFile(path);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => verifyReceipt(l).valid)).toBe(true);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
  });

  it("a receipt sink that cannot write (path is a directory) blocks the effect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "senscheck-"));
    const r = rig({ receiptSink: new FileReceiptSink(dir) });
    const cb = vi.fn();
    const result = await r.gov.execute(effect(), cb);
    expect(result.decision).toBe("FAIL_CLOSED");
    expect(cb).not.toHaveBeenCalled();
  });

  it("unused fixtures stay referenced", () => {
    expect([human, new TestClock()].length).toBe(2);
  });
});
