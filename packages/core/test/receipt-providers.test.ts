import { describe, expect, it, vi } from "vitest";
import {
  ConsoleReceiptSink,
  EnvironmentAuthorityProvider,
  MemoryReceiptSink,
  StaticApprovalProvider,
  StaticAuthorityProvider,
  CallbackApprovalProvider,
  createReceipt,
  verifyReceipt,
} from "@senscheck/governance-core";
import { T0, TestClock, agent, effect, human } from "./helpers.js";

const base = {
  effectId: "e1",
  effectDigest: "d",
  principalId: "p",
  decision: "DENY" as const,
  reasonCodes: ["X"],
  authorized: false,
  attempted: false,
  occurred: false,
  phase: "DECIDED" as const,
  evaluatedAt: "2026-10-02T12:00:00Z",
  policyVersion: "v1",
};

describe("receipts", () => {
  it("round-trips and detects tampering (integrity, not authenticity)", () => {
    const r = createReceipt(base);
    expect(verifyReceipt(r)).toEqual({ valid: true, errors: [] });
    expect(verifyReceipt({ ...r, decision: "ALLOW" }).valid).toBe(false);
    expect(verifyReceipt({ ...r, metadata: { x: 1 } }).errors).toContain("integrity digest mismatch: receipt was modified");
    expect(r.integrity.algorithm).toBe("sha256");
  });

  it("rejects structurally invalid receipts", () => {
    const r = createReceipt(base);
    for (const bad of [null, 5, [], { ...r, receiptVersion: "9" }, { ...r, receiptId: "" }, { ...r, effectDigest: 5 }, { ...r, decision: "NO" }, { ...r, phase: "?" }, { ...r, reasonCodes: [1] }, { ...r, reasonCodes: "x" }, { ...r, occurred: "yes" }, { ...r, evaluatedAt: "now" }, { ...r, metadata: null }, { ...r, integrity: undefined }, { ...r, integrity: null }, { ...r, integrity: { algorithm: "md5", digest: "x" } }]) {
      expect(verifyReceipt(bad).valid).toBe(false);
    }
  });

  it("rejects contradictory claims", () => {
    const occurredNoAttempt = createReceipt({ ...base, decision: "ALLOW", authorized: true, occurred: true });
    expect(verifyReceipt(occurredNoAttempt).errors).toContain("occurred without attempted");
    const denyClaimsAttempt = createReceipt({ ...base, attempted: true });
    expect(verifyReceipt(denyClaimsAttempt).errors).toContain("non-ALLOW receipt claims authorization or attempt");
  });

  it("flags receipts whose metadata cannot be canonicalized", () => {
    const r = createReceipt(base);
    const evil = { ...r, metadata: { f: () => 1 } };
    expect(verifyReceipt(evil).errors).toContain("receipt not canonicalizable");
  });

  it("MemoryReceiptSink is bounded; ConsoleReceiptSink writes JSON lines", () => {
    const sink = new MemoryReceiptSink(2);
    for (let i = 0; i < 3; i++) sink.write(createReceipt({ ...base, effectId: `e${i}` }));
    expect(sink.receipts.map((r) => r.effectId)).toEqual(["e1", "e2"]);
    const out = vi.fn();
    new ConsoleReceiptSink(out).write(createReceipt(base));
    expect(JSON.parse(out.mock.calls[0]![0] as string).effectId).toBe("e1");
  });

  it("ConsoleReceiptSink default writes to stderr, not stdout", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    new ConsoleReceiptSink().write(createReceipt(base));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("local providers", () => {
  const clock = new TestClock();
  const grant = {
    principalId: agent.id,
    verbs: ["DELETE"],
    resources: ["file:/tmp/*"],
    expiresAt: new Date(T0 + 1000).toISOString(),
    grantedBy: { id: "admin", type: "human" },
  };
  const req = (e = effect(), digest = "dig") => ({ effect: e, effectDigest: digest, context: {} });

  it("StaticAuthorityProvider grants only exact matches; there is no implicit wildcard", () => {
    const p = new StaticAuthorityProvider([grant], clock.now);
    expect(p.check(req()).status).toBe("GRANTED");
    expect(p.check(req(effect({ verb: "DEPLOY" }))).status).toBe("NOT_GRANTED");
    expect(p.check(req(effect({ resource: "file:/etc/x" }))).status).toBe("NOT_GRANTED");
    expect(p.check(req(effect({ principal: { id: "other", type: "agent" } }))).status).toBe("NOT_GRANTED");
  });

  it("StaticAuthorityProvider can bind a grant to one digest", () => {
    const p = new StaticAuthorityProvider([{ ...grant, effectDigest: "dig" }], clock.now);
    const ok = p.check(req(effect(), "dig"));
    expect(ok.status).toBe("GRANTED");
    expect(ok.effectDigest).toBe("dig");
    expect(p.check(req(effect(), "other")).status).toBe("NOT_GRANTED");
  });

  it("EnvironmentAuthorityProvider needs principals and an expiry", () => {
    const env = { SENSCHECK_AUTHORIZED_PRINCIPALS: " coding-agent , x ", SENSCHECK_AUTHORITY_EXPIRES: "2027-01-01T00:00:00Z", SENSCHECK_AUTHORITY_GRANTED_BY: "ops" };
    const p = new EnvironmentAuthorityProvider(env, clock.now);
    const granted = p.check(req());
    expect(granted.status).toBe("GRANTED");
    expect(granted.grantedBy.id).toBe("ops");
    expect(new EnvironmentAuthorityProvider({ ...env, SENSCHECK_AUTHORITY_EXPIRES: undefined }, clock.now).check(req()).status).toBe("NOT_GRANTED");
    expect(new EnvironmentAuthorityProvider({}, clock.now).check(req())).toMatchObject({ status: "NOT_GRANTED", grantedBy: { id: "operator" } });
    expect(new EnvironmentAuthorityProvider(env, clock.now).check(req(effect({ principal: { id: "z", type: "agent" } }))).status).toBe("NOT_GRANTED");
    expect(new EnvironmentAuthorityProvider().check(req()).status).toBe("NOT_GRANTED");
  });

  it("StaticApprovalProvider tracks approvals by digest", () => {
    const p = new StaticApprovalProvider(clock.now);
    expect(p.check(req()).status).toBe("PENDING");
    const rec = p.approve("dig", human, 1000);
    expect(p.check(req()).status).toBe("APPROVED");
    expect(rec.approvalId).toMatch(/^appr_1_/);
    p.reject("dig");
    expect(p.check(req()).status).toBe("REJECTED");
    p.approve("dig", human);
    expect(p.check(req()).status).toBe("APPROVED");
  });

  it("CallbackApprovalProvider delegates", async () => {
    const p = new CallbackApprovalProvider(() => ({ status: "PENDING" }));
    expect(await p.check(req())).toEqual({ status: "PENDING" });
  });
});
