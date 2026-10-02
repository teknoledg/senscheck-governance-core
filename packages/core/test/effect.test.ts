import { describe, expect, it } from "vitest";
import { canonicalizeEffect, canonicalJson, createEffect, effectDigest, maxRisk, riskRank } from "@senscheck/governance-core";
import { agent, effect } from "./helpers.js";

describe("canonical effect (FC-011, FC-018)", () => {
  it("accepts a well-formed effect and returns a frozen deep copy with a digest", () => {
    const input = effect({ parameters: { a: { b: [1, 2] } } });
    const r = canonicalizeEffect(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.isFrozen(r.canonical.effect.parameters)).toBe(true);
    expect(r.canonical.effect).not.toBe(input);
    expect(r.canonical.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("digest ignores key order, effectId, proposedAt and metadata; covers material fields", () => {
    const a = effect({ parameters: { x: 1, y: 2 }, metadata: { m: 1 } });
    const b = { ...effect({ parameters: { y: 2, x: 1 }, metadata: { m: 2 } }), effectId: "eff_other", proposedAt: "2030-01-01T00:00:00Z" };
    expect(effectDigest(a)).toBe(effectDigest(b));
    expect(effectDigest(a)).not.toBe(effectDigest(effect({ parameters: { x: 1, y: 3 } })));
    expect(effectDigest(a)).not.toBe(effectDigest(effect({ parameters: { x: 1, y: 2 }, resource: "file:/other" })));
    expect(effectDigest(a)).not.toBe(effectDigest(effect({ parameters: { x: 1, y: 2 }, risk: "HIGH" })));
  });

  it("createEffect generates ids and honours overrides", () => {
    const e = createEffect({ principal: agent, verb: "READ", resource: "r", risk: "LOW" });
    expect(e.effectId).toMatch(/^eff_/);
    const f = createEffect({ principal: agent, verb: "READ", resource: "r", risk: "LOW", effectId: "e1", proposedAt: "2026-01-01T00:00:00Z", parameters: { a: 1 }, metadata: { m: 1 } });
    expect(f).toMatchObject({ effectId: "e1", proposedAt: "2026-01-01T00:00:00Z", parameters: { a: 1 }, metadata: { m: 1 } });
  });

  const bad: Array<[string, (e: Record<string, unknown>) => unknown]> = [
    ["not an object", () => "x"],
    ["array", () => []],
    ["null", () => null],
    ["wrong schemaVersion", (e) => ({ ...e, schemaVersion: "2.0" })],
    ["bad effectId", (e) => ({ ...e, effectId: "has space" })],
    ["non-string effectId", (e) => ({ ...e, effectId: 5 })],
    ["unknown top-level field", (e) => ({ ...e, extra: 1 })],
    ["principal not object", (e) => ({ ...e, principal: "bob" })],
    ["empty principal id", (e) => ({ ...e, principal: { id: "", type: "agent" } })],
    ["long principal id", (e) => ({ ...e, principal: { id: "x".repeat(300), type: "agent" } })],
    ["control char principal id", (e) => ({ ...e, principal: { id: "a\nb", type: "agent" } })],
    ["bad principal type", (e) => ({ ...e, principal: { id: "a", type: "root" } })],
    ["extra principal field", (e) => ({ ...e, principal: { id: "a", type: "agent", admin: true } })],
    ["action not object", (e) => ({ ...e, action: "DELETE" })],
    ["lowercase verb", (e) => ({ ...e, action: { verb: "delete", resource: "r" } })],
    ["non-string verb", (e) => ({ ...e, action: { verb: 1, resource: "r" } })],
    ["empty resource", (e) => ({ ...e, action: { verb: "DELETE", resource: "" } })],
    ["resource with newline", (e) => ({ ...e, action: { verb: "DELETE", resource: "a\nb" } })],
    ["resource too long", (e) => ({ ...e, action: { verb: "DELETE", resource: "x".repeat(2000) } })],
    ["extra action field", (e) => ({ ...e, action: { verb: "DELETE", resource: "r", x: 1 } })],
    ["unknown risk", (e) => ({ ...e, risk: "EXTREME" })],
    ["bad proposedAt", (e) => ({ ...e, proposedAt: "yesterday" })],
    ["impossible proposedAt", (e) => ({ ...e, proposedAt: "2026-99-99T99:99:99Z" })],
    ["parameters array", (e) => ({ ...e, parameters: [] })],
    ["metadata null", (e) => ({ ...e, metadata: null })],
    ["function in parameters", (e) => ({ ...e, parameters: { f: () => 1 } })],
    ["bigint in parameters", (e) => ({ ...e, parameters: { n: 1n } })],
    ["NaN in parameters", (e) => ({ ...e, parameters: { n: Number.NaN } })],
    ["Date in parameters", (e) => ({ ...e, parameters: { d: new Date() } })],
    ["undefined in array", (e) => ({ ...e, parameters: { a: [undefined] } })],
    ["circular parameters", (e) => { const p: Record<string, unknown> = {}; p["self"] = p; return { ...e, parameters: p }; }],
    ["too deep", (e) => { let p: Record<string, unknown> = {}; const root = p; for (let i = 0; i < 40; i++) { const n = {}; p["n"] = n; p = n; } return { ...e, parameters: root }; }],
    ["too large", (e) => ({ ...e, parameters: { blob: "x".repeat(1_100_000) } })],
  ];
  it.each(bad)("rejects: %s", (_name, mutate) => {
    const r = canonicalizeEffect(mutate({ ...effect() } as unknown as Record<string, unknown>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("drops undefined object properties like JSON, and normalizes -0", () => {
    expect(canonicalJson({ b: undefined, a: -0 })).toBe('{"a":0}');
  });

  it("an object with a non-Object prototype is not plain", () => {
    class X {}
    expect(canonicalizeEffect({ ...effect(), parameters: { x: new X() } }).ok).toBe(false);
    const nullProto = Object.create(null) as Record<string, unknown>;
    nullProto["a"] = 1;
    expect(canonicalizeEffect({ ...effect(), parameters: nullProto }).ok).toBe(true);
  });

  it("does not-throw on an Error thrown by a getter during cloning", () => {
    const params = {};
    Object.defineProperty(params, "boom", { enumerable: true, get() { throw new Error("getter"); } });
    const r = canonicalizeEffect({ ...effect(), parameters: params });
    expect(r.ok).toBe(false);
  });

  it("risk ordering helpers", () => {
    expect(riskRank("LOW")).toBeLessThan(riskRank("CRITICAL"));
    expect(maxRisk("LOW", "HIGH")).toBe("HIGH");
    expect(maxRisk("CRITICAL", "MEDIUM")).toBe("CRITICAL");
  });
});
