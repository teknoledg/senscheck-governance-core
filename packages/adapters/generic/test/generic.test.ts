import { describe, expect, it, vi } from "vitest";
import { GovernanceBlockedError, MemoryReceiptSink, SensCheckGovernance, StaticApprovalProvider, StaticAuthorityProvider, createEffect, type PolicyConfig } from "@senscheck/governance-core";
import { classifySql, governFetch, governFs, governProcess, governSql } from "@senscheck/generic-tools";
import { resolve } from "node:path";

const principal = { id: "agent-1", type: "agent" as const };
const human = { id: "alice", type: "human" };
const allow: PolicyConfig = { version: 1, default: "DENY", rules: [{ id: "all", when: { resource: "*" }, decision: "ALLOW" }] };

function rig(policy: PolicyConfig = allow) {
  const sink = new MemoryReceiptSink();
  const approvals = new StaticApprovalProvider();
  const gov = new SensCheckGovernance({
    policies: [policy],
    authorityProvider: new StaticAuthorityProvider([{ principalId: principal.id, verbs: ["*"], resources: ["*"], expiresAt: new Date(Date.now() + 3_600_000).toISOString(), grantedBy: { id: "admin", type: "human" } }]),
    approvalProvider: approvals,
    receiptSink: sink,
  });
  return { gov, sink, approvals, o: { governance: gov, principal } };
}

describe("governFs", () => {
  const fake = () => ({ writeFile: vi.fn(async () => {}), appendFile: vi.fn(async () => {}), rm: vi.fn(async () => {}), rename: vi.fn(async () => {}), mkdir: vi.fn(async () => undefined) });

  it("runs allowed mutations and binds content and resolved paths", async () => {
    const { o, sink } = rig();
    const fs = fake();
    const g = governFs(fs, o);
    await g.writeFile("/tmp/a/../b.txt", "hello");
    await g.appendFile("/tmp/x", new Uint8Array([1, 2]));
    await g.mkdir("/tmp/d", { recursive: true });
    await g.rename("/tmp/a", "/tmp/b");
    expect(fs.writeFile).toHaveBeenCalledWith("/tmp/a/../b.txt", "hello", undefined);
    expect(sink.receipts[0]?.metadata["resource"]).toBe("file:/tmp/b.txt");
  });

  it("recursive delete is HIGH risk: needs approval, and does not run without it", async () => {
    const { o, gov, approvals } = rig();
    const fs = fake();
    const g = governFs(fs, o);
    const err = await g.rm("/srv/data", { recursive: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GovernanceBlockedError);
    expect((err as GovernanceBlockedError).decision).toBe("REQUIRE_APPROVAL");
    expect(fs.rm).not.toHaveBeenCalled();

    const digest = (await gov.evaluate(createEffect({ principal, verb: "DELETE", resource: `file:${resolve("/srv/data")}`, risk: "HIGH", parameters: { path: resolve("/srv/data"), recursive: true } }))).effectDigest!;
    approvals.approve(digest, human);
    await g.rm("/srv/data", { recursive: true });
    expect(fs.rm).toHaveBeenCalledTimes(1);
    expect(approvals).toBeDefined();
  });

  it("an unsupported data type fails closed", async () => {
    const { o } = rig();
    const fs = fake();
    await expect(governFs(fs, o).writeFile("/tmp/x", { not: "bytes" } as never)).rejects.toBeInstanceOf(GovernanceBlockedError);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("resource denylists apply (defence in depth)", async () => {
    const { o } = rig({ ...allow, resourceDenylist: ["file:/etc/*"] });
    const fs = fake();
    await expect(governFs(fs, o).writeFile("/etc/passwd", "x")).rejects.toMatchObject({ decision: "DENY" });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("governProcess", () => {
  it("is HIGH risk by default and blocked without approval", async () => {
    const { o } = rig();
    const run = vi.fn(async () => "out");
    await expect(governProcess(run, o)("rm", ["-rf", "/"])).rejects.toMatchObject({ decision: "REQUIRE_APPROVAL" });
    expect(run).not.toHaveBeenCalled();
  });

  it("can be lowered explicitly to run without approval", async () => {
    const { o } = rig();
    const run = vi.fn(async () => "out");
    expect(await governProcess(run, { ...o, risk: "MEDIUM" })("ls", ["-la"], { cwd: "/tmp" })).toBe("out");
    expect(await governProcess(run, { ...o, risk: "MEDIUM" })("ls", [])).toBe("out");
  });
});

describe("governFetch", () => {
  it("GET passes through ungoverned; POST is governed and binds the body", async () => {
    const { o, sink } = rig();
    const f = vi.fn(async () => "resp");
    const g = governFetch(f, o);
    expect(await g("https://api.example.com/x?y=1")).toBe("resp");
    expect(await g("https://api.example.com/x", { method: "head" })).toBe("resp");
    expect(sink.receipts).toHaveLength(0);
    expect(await g("https://api.example.com/items", { method: "POST", body: "{}" })).toBe("resp");
    expect(await g("https://api.example.com/items", { method: "PUT", body: new URLSearchParams({ a: "1" }) })).toBe("resp");
    expect(await g("https://api.example.com/items", { method: "PATCH", body: new Uint8Array([1]) })).toBe("resp");
    expect(await g("https://api.example.com/items", { method: "POST" })).toBe("resp");
    expect(await g("https://api.example.com/items", { method: "POST", body: null })).toBe("resp");
    expect(sink.receipts[0]?.metadata["resource"]).toBe("http:https://api.example.com/items");
  });

  it("an unhashable body or bad URL fails closed", async () => {
    const { o } = rig();
    const f = vi.fn(async () => "resp");
    const g = governFetch(f, o);
    await expect(g("https://a.example/x", { method: "POST", body: { stream: true } })).rejects.toBeInstanceOf(GovernanceBlockedError);
    await expect(g("not a url", { method: "POST" })).rejects.toBeInstanceOf(GovernanceBlockedError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("governSql", () => {
  it("classifies conservatively", () => {
    expect(classifySql("SELECT * FROM t")).toBe("READ");
    expect(classifySql("  /* c */ select 1 -- x\n;")).toBe("READ");
    expect(classifySql("SELECT * INTO backup FROM t")).toBe("UNKNOWN");
    expect(classifySql("SELECT 1; DROP TABLE t")).toBe("UNKNOWN");
    expect(classifySql("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x")).toBe("UNKNOWN");
    expect(classifySql("insert into t values (1)")).toBe("WRITE");
    expect(classifySql("DROP TABLE t")).toBe("DESTRUCTIVE");
    expect(classifySql("")).toBe("UNKNOWN");
    expect(classifySql("PRAGMA writable_schema=1")).toBe("UNKNOWN");
  });

  it("reads pass through; writes run when allowed; destructive/unknown need approval", async () => {
    const { o } = rig();
    const run = vi.fn(async () => "rows");
    const q = governSql(run, { ...o, database: "main" });
    expect(await q("SELECT 1")).toBe("rows");
    expect(await q("INSERT INTO t VALUES (?)", [1])).toBe("rows");
    expect(await q("UPDATE t SET a = 1")).toBe("rows");
    run.mockClear();
    await expect(q("DROP TABLE t")).rejects.toMatchObject({ decision: "REQUIRE_APPROVAL" });
    await expect(q("VACUUM")).rejects.toMatchObject({ decision: "REQUIRE_APPROVAL" });
    expect(run).not.toHaveBeenCalled();
  });
});
