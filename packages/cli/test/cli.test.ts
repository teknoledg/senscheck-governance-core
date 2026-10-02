import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryReceiptSink, SensCheckGovernance, createEffect } from "@senscheck/governance-core";
import { FileReceiptSink } from "@senscheck/governance-core/node";
import { auditSource, main, runSelfTests, type Io } from "../src/index.js";

async function cli(args: string[], cwd?: string) {
  const dir = cwd ?? (await mkdtemp(join(tmpdir(), "sc-cli-")));
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), cwd: dir };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n"), dir };
}

describe("senscheck init / check", () => {
  it("init creates a valid config, example, and gitignore entry; check accepts it", async () => {
    const r = await cli(["init"]);
    expect(r.code).toBe(0);
    expect(await readFile(join(r.dir, ".gitignore"), "utf8")).toContain(".senscheck/");
    expect(await readFile(join(r.dir, "senscheck.example.mjs"), "utf8")).toContain("wrapFunction");
    const check = await cli(["check"], r.dir);
    expect(check.code).toBe(0);
    expect(check.out).toContain("OK");
  });

  it("init does not overwrite without --force and appends to an existing .gitignore once", async () => {
    const r = await cli(["init"]);
    await writeFile(join(r.dir, "senscheck.config.json"), "custom");
    const again = await cli(["init"], r.dir);
    expect(again.out).toContain("skip    senscheck.config.json");
    expect(await readFile(join(r.dir, "senscheck.config.json"), "utf8")).toBe("custom");
    const forced = await cli(["init", "--force"], r.dir);
    expect(forced.out).toContain("created senscheck.config.json");
    const gi = await readFile(join(r.dir, ".gitignore"), "utf8");
    expect(gi.match(/\.senscheck\//g)).toHaveLength(1);
    const dir2 = await mkdtemp(join(tmpdir(), "sc-cli-"));
    await writeFile(join(dir2, ".gitignore"), "node_modules");
    await cli(["init"], dir2);
    expect(await readFile(join(dir2, ".gitignore"), "utf8")).toContain("node_modules\n# senscheck");
  });

  it("check rejects invalid and unreadable config with a non-zero exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-cli-"));
    await writeFile(join(dir, "bad.json"), JSON.stringify({ version: 1, default: "ALLOW", rules: [] }));
    const bad = await cli(["check", "bad.json"], dir);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("ALLOW is not a valid default");
    expect((await cli(["check", "missing.json"], dir)).code).toBe(2);
    await writeFile(join(dir, "broken.json"), "{not json");
    expect((await cli(["check", "broken.json"], dir)).code).toBe(2);
  });

  it("check warns about over-broad configs but still passes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-cli-"));
    await writeFile(join(dir, "senscheck.config.json"), JSON.stringify({ version: 1, default: "DENY", rules: [{ id: "all", when: { resource: "*" }, decision: "ALLOW" }] }));
    const r = await cli(["check"], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("warning: no DENY rules");
    expect(r.out).toContain('rule "all" allows every verb');
  });
});

describe("senscheck audit", () => {
  const sample = [
    'import { rm } from "node:fs/promises";',
    'import { execSync } from "node:child_process";',
    "// fs.rmSync('/commented')",
    'await rm("/tmp/x", { recursive: true });',
    'execSync("kubectl apply -f deploy.yaml");',
    'await fetch(url, { method: "POST", body });',
    'db.query("DELETE FROM users WHERE id = 1");',
    'try { check() } catch (e) { return true }',
  ].join("\n");

  it("finds likely consequential operations across categories and ignores comments", () => {
    const f = auditSource("a.ts", sample);
    const cats = new Set(f.map((x) => x.category));
    for (const c of ["filesystem mutation", "process execution", "deployment command", "HTTP mutation", "database write", "FAIL_OPEN"]) {
      expect(cats.has(c)).toBe(true);
    }
    expect(f.some((x) => x.snippet.includes("commented"))).toBe(false);
    expect(f.every((x) => !x.fileMentionsSenscheck)).toBe(true);
  });

  it("covers python, cloud, credentials and shell patterns", () => {
    const f = auditSource("a.py", ["shutil.rmtree(path)", "subprocess.run(cmd, shell=True)", "requests.post(url)", "s3.putObject(params)", "os.chmod(p, 0o777)".replace("os.chmod", "chmod"), "# os.remove(x)"].join("\n"));
    expect(new Set(f.map((x) => x.id))).toEqual(new Set(["fs-mutation-py", "child-process-py", "shell-true", "http-client-mutation", "cloud-mutation", "credential-change"]));
  });

  it("marks files that mention @senscheck, and walks a project skipping node_modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-audit-"));
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "node_modules", "x", "i.js"), "fs.writeFileSync(a,b)");
    await writeFile(join(dir, "src", "a.ts"), 'import "@senscheck/governance-core";\nfs.writeFileSync(a,b)');
    await writeFile(join(dir, "src", "b.ts"), "fs.writeFileSync(a,b)");
    await writeFile(join(dir, "src", "notes.md"), "fs.writeFileSync(a,b)");
    const r = await cli(["audit", "--json"], dir);
    const report = JSON.parse(r.out) as { scannedFiles: number; findings: Array<{ file: string; fileMentionsSenscheck: boolean }> };
    expect(report.scannedFiles).toBe(2);
    expect(report.findings.map((x) => x.file).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(report.findings.find((x) => x.file === "src/a.ts")?.fileMentionsSenscheck).toBe(true);

    const text = await cli(["audit"], dir);
    expect(text.out).toContain("Static pattern matching only");
    expect(text.code).toBe(0);
    expect((await cli(["audit", "--fail-on-findings"], dir)).code).toBe(1);
    expect((await cli(["audit", "src/a.ts", "--fail-on-findings"], dir)).code).toBe(0);
    expect((await cli(["audit", "nope"], dir)).code).toBe(2);
  });
});

describe("senscheck test", () => {
  it("every built-in fail-closed scenario passes against the real engine", async () => {
    const results = await runSelfTests();
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(20);
    expect(results.filter((r) => r.expect !== "ALLOW").every((r) => !r.calledCallback)).toBe(true);
  });

  it("runs with the init config and exits 0", async () => {
    const r = await cli(["init"]);
    const t = await cli(["test"], r.dir);
    expect(t.code).toBe(0);
    expect(t.out).toContain("your config does not ALLOW an effect no rule matches");
    expect(t.out).toMatch(/\d+\/\d+ passed/);
  });

  it("without a config runs built-ins; with a bad config it refuses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-cli-"));
    const t = await cli(["test"], dir);
    expect(t.code).toBe(0);
    expect(t.out).toContain("built-in");
    await writeFile(join(dir, "senscheck.config.json"), '{"version":1}');
    expect((await cli(["test"], dir)).code).toBe(1);
    await writeFile(join(dir, "broken.json"), "{");
    expect((await cli(["test", "--config", "broken.json"], dir)).code).toBe(1);
    expect((await cli(["test", "--config", "absent.json"], dir)).code).toBe(2);
  });

  it("a failing scenario is reported (self-test harness detects a fail-open engine)", async () => {
    // Sanity check on the harness: an allow-everything policy makes the 'user config' scenario fail.
    const results = await runSelfTests({ version: 1, default: "DENY", rules: [{ id: "all", when: { resource: "*" }, decision: "ALLOW" }] });
    expect(results.find((r) => r.name.startsWith("your config"))?.ok).toBe(false);
  });
});

describe("senscheck explain", () => {
  it("explains a JSONL receipt log produced by the engine and verifies integrity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-explain-"));
    const path = join(dir, "r.jsonl");
    const gov = new SensCheckGovernance({ policies: [], receiptSink: new FileReceiptSink(path) });
    const agent = { id: "a1", type: "agent" as const };
    await gov.authorize(createEffect({ principal: agent, verb: "DELETE", resource: "file:/x", risk: "HIGH" }));
    await gov.authorize({ junk: true });
    const r = await cli(["explain", "r.jsonl"], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain("NO_POLICY_PROVIDER");
    expect(r.out).toContain("the action did NOT run");
    expect(r.out).toContain("digest matches");
    expect(r.out).toContain("INVALID_EFFECT");
  });

  it("flags tampered receipts and handles single-object and array files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-explain-"));
    const sink = new MemoryReceiptSink();
    const gov = new SensCheckGovernance({ policies: [], receiptSink: sink });
    await gov.authorize({ junk: true });
    const receipt = sink.receipts[0]!;
    await writeFile(join(dir, "one.json"), JSON.stringify(receipt, null, 2));
    expect((await cli(["explain", "one.json"], dir)).out).toContain("digest matches");
    await writeFile(join(dir, "tampered.json"), JSON.stringify({ ...receipt, decision: "ALLOW" }));
    expect((await cli(["explain", "tampered.json"], dir)).out).toContain("integrity : INVALID");
    await writeFile(join(dir, "arr.json"), JSON.stringify([receipt, 5]));
    const arr = await cli(["explain", "arr.json"], dir);
    expect(arr.code).toBe(1);
    expect(arr.err).toContain("entry is not an object");
    await writeFile(join(dir, "unknown.json"), JSON.stringify({ ...receipt, reasonCodes: ["MYSTERY"] }));
    expect((await cli(["explain", "unknown.json"], dir)).out).toContain("unrecognised reason code");
  });

  it("explains the lifecycle meaning of allowed/attempted/occurred receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sc-explain-"));
    const sink = new MemoryReceiptSink();
    const { StaticAuthorityProvider } = await import("@senscheck/governance-core");
    const agent = { id: "a1", type: "agent" as const };
    const gov = new SensCheckGovernance({
      policies: [{ version: 1, default: "DENY", rules: [{ id: "a", when: { resource: "*" }, decision: "ALLOW" }] }],
      authorityProvider: new StaticAuthorityProvider([{ principalId: "a1", verbs: ["*"], resources: ["*"], expiresAt: new Date(Date.now() + 60_000).toISOString(), grantedBy: { id: "op", type: "human" } }]),
      receiptSink: sink,
    });
    await gov.execute(createEffect({ principal: agent, verb: "X", resource: "r", risk: "LOW" }), () => 1);
    await gov.execute(createEffect({ principal: agent, verb: "X", resource: "r", risk: "LOW" }), () => { throw new Error("x"); });
    await writeFile(join(dir, "r.json"), JSON.stringify(sink.receipts));
    const out = (await cli(["explain", "r.json"], dir)).out;
    expect(out).toContain("governance allowed it; no completion is recorded");
    expect(out).toContain("ran to completion");
    expect(out).toContain("attempted but did not complete");
  });

  it("usage errors", async () => {
    expect((await cli(["explain"])).code).toBe(2);
    expect((await cli(["explain", "missing"])).code).toBe(2);
    const dir = await mkdtemp(join(tmpdir(), "sc-explain-"));
    await writeFile(join(dir, "bad"), "nope");
    expect((await cli(["explain", "bad"], dir)).code).toBe(2);
  });
});

describe("senscheck usage", () => {
  it("help, unknown command, no command", async () => {
    expect((await cli(["--help"])).out).toContain("Usage:");
    expect((await cli(["help"])).code).toBe(0);
    const unknown = await cli(["frobnicate"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("unknown command");
    expect((await cli([])).code).toBe(2);
    expect((await cli(["check", "--bogus"])).code).toBe(2);
  });
});
