// Release verification on the PACKED artifacts: pack, inspect, install into a clean fixture, run examples/CLI,
// prove callbacks never run on DENY/FAIL_CLOSED, prove no network access, scan for secrets.
// Prints one line per step and exits non-zero on any failure. Nothing is reported that was not executed.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const artifacts = join(root, ".artifacts");
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

const packages = [
  ["packages/core", "@senscheck/governance-core"],
  ["packages/mcp", "@senscheck/governance-mcp"],
  ["packages/cli", "@senscheck/governance-cli"],
  ["packages/adapters/generic", "@senscheck/generic-tools"],
  ["packages/adapters/openai", "@senscheck/governance-openai"],
];

// 1. pack
rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });
const tarballs = {};
for (const [dir, name] of packages) {
  const r = run("pnpm", ["pack", "--pack-destination", artifacts], { cwd: join(root, dir) });
  const file = readdirSync(artifacts).find((f) => f.startsWith(name.slice(1).replace("/", "-") + "-"));
  step(`pnpm pack ${name}`, r.status === 0 && !!file, file);
  if (file) tarballs[name] = join(artifacts, file);
}

// 2. inspect tarball contents
const FORBIDDEN = [/(^|\/)test\//, /\.test\./, /\.env/, /\.pem$/, /tsconfig/, /(^|\/)src\//];
for (const [name, file] of Object.entries(tarballs)) {
  const listing = run("tar", ["-tzf", file]).stdout.split("\n").filter(Boolean).map((l) => l.replace(/^package\//, ""));
  const bad = listing.filter((l) => FORBIDDEN.some((re) => re.test(l)));
  const need = ["package.json", "LICENSE", "README.md", "dist/index.js"].filter((n) => !listing.includes(n) && !(n === "dist/index.js" && name.includes("cli")));
  step(`tarball contents ${name}`, bad.length === 0 && need.length === 0, `${listing.length} files${bad.length ? `, unexpected: ${bad.join(",")}` : ""}${need.length ? `, missing: ${need.join(",")}` : ""}`);
  const manifest = JSON.parse(run("tar", ["-xzOf", file, "package/package.json"]).stdout);
  const workspaceLeak = JSON.stringify(manifest).includes("workspace:");
  step(`no workspace: specifiers in ${name}`, !workspaceLeak);
  const deps = Object.keys(manifest.dependencies ?? {});
  step(`runtime deps ${name}`, name === "@senscheck/governance-core" ? deps.length === 0 : deps.every((d) => d.startsWith("@senscheck/")), deps.join(",") || "none");
}

// 3. clean fixture install from tarballs only
const fixture = mkdtempSync(join(tmpdir(), "senscheck-fixture-"));
const dependencies = Object.fromEntries(Object.entries(tarballs).map(([n, f]) => [n, `file:${f}`]));
const overrides = Object.fromEntries(Object.keys(tarballs).map((n) => [n, `$${n}`]));
writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module", dependencies, overrides }, null, 2));
const install = run("npm", ["install", "--no-audit", "--no-fund", "@modelcontextprotocol/sdk", "zod@3"], { cwd: fixture });
step("npm install packed tarballs into clean fixture", install.status === 0, install.status === 0 ? "" : install.stderr.slice(-400));

// 4. examples from the packed artifact, with network access trapped
cpSync(join(root, "examples"), join(fixture, "examples"), { recursive: true, filter: (s) => !s.includes("node_modules") });
rmSync(join(fixture, "examples", "package.json"));
const preload = join(root, "scripts", "no-network.cjs");
for (const ex of ["coding-agent", "filesystem-agent", "deployment-agent", "database-agent", "http-agent", "mcp-tool"]) {
  const r = run("node", ["--require", preload, join("examples", ex, "index.mjs")], { cwd: fixture });
  step(`example ${ex} (packed artifact, network trapped)`, r.status === 0, r.status === 0 ? "" : `exit ${r.status}: ${(r.stderr || r.stdout).slice(-300)}`);
}

// 5. CLI from packed artifact
const bin = join(fixture, "node_modules", ".bin", "senscheck");
const cliRun = (args) => run("node", ["--require", preload, bin, ...args], { cwd: fixture });
const cli = [["init"], ["check"], ["test"], ["audit", "examples"]].map((a) => [a, cliRun(a)]);
for (const [a, r] of cli) step(`senscheck ${a.join(" ")} (packed)`, r.status === 0, r.status === 0 ? "" : (r.stderr || r.stdout).slice(-300));
const testOut = cli.find(([a]) => a[0] === "test")?.[1].stdout ?? "";
step("senscheck test reports all scenarios passing", /(\d+)\/\1 passed/.test(testOut), testOut.split("\n").filter((l) => /passed/.test(l)).join(""));
step("senscheck init example wrapper runs", run("node", ["--require", preload, "senscheck.example.mjs"], { cwd: fixture }).status === 0);

// 6. DENY / FAIL_CLOSED never invoke the callback: direct proof against packed core
writeFileSync(join(fixture, "proof.mjs"), `
import { SensCheckGovernance, StaticAuthorityProvider, createEffect } from "@senscheck/governance-core";
const agent = { id: "a", type: "agent" };
const good = new StaticAuthorityProvider([{ principalId: "a", verbs: ["*"], resources: ["*"], expiresAt: new Date(Date.now()+60000).toISOString(), grantedBy: { id: "op", type: "human" } }]);
let calls = 0;
const eff = () => createEffect({ principal: agent, verb: "WRITE", resource: "x:y", risk: "LOW" });
const denyGov = new SensCheckGovernance({ policies: [{ version: 1, default: "DENY", rules: [] }], authorityProvider: good });
const failGov = new SensCheckGovernance({ policies: [{ version: 1, default: "DENY", rules: [{ id: "a", when: { resource: "*" }, decision: "ALLOW" }] }], authorityProvider: { check: () => { throw new Error("down"); } } });
const allowGov = new SensCheckGovernance({ policies: [{ version: 1, default: "DENY", rules: [{ id: "a", when: { resource: "*" }, decision: "ALLOW" }] }], authorityProvider: good });
const d = await denyGov.execute(eff(), () => { calls++; });
const f = await failGov.execute(eff(), () => { calls++; });
console.log(d.decision, f.decision, "callbackCalls=" + calls);
if (d.decision !== "DENY" || f.decision !== "FAIL_CLOSED" || calls !== 0) process.exit(1);
const a = await allowGov.execute(eff(), () => { calls++; });
if (a.decision !== "ALLOW" || calls !== 1) process.exit(2);
console.log("ALLOW runs exactly once");
`);
const proof = run("node", ["--require", preload, "proof.mjs"], { cwd: fixture });
step("callback never runs on DENY or FAIL_CLOSED (packed core)", proof.status === 0, proof.stdout.trim().replace(/\n/g, " | "));

// 7. static scan of shipped code for network APIs
const NET = /node:(http|https|net|tls|dns|dgram|http2)\b|globalThis\.fetch|XMLHttpRequest|new WebSocket/;
const netHits = [];
for (const [, name] of packages) {
  const dist = join(fixture, "node_modules", ...name.split("/"), "dist");
  const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") && NET.test(readFileSync(p, "utf8")) && netHits.push(relative(fixture, p)); });
  walk(dist);
}
step("no network APIs imported by shipped code", netHits.length === 0, netHits.join(","));

// 8. secrets scan of tracked sources
const SECRET = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|npm_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,})/;
const hits = [];
const scan = (d) => {
  for (const f of readdirSync(d)) {
    if (["node_modules", ".git", "dist", "coverage", ".artifacts"].includes(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) scan(p);
    else if (statSync(p).size < 2_000_000 && SECRET.test(readFileSync(p, "utf8"))) hits.push(relative(root, p));
  }
};
scan(root);
step("secret scan (private keys, cloud/npm/GitHub/OpenAI/Slack tokens)", hits.length === 0, hits.join(","));
const dotenv = existsSync(join(root, ".env"));
step("no .env file in repo", !dotenv);

rmSync(fixture, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} release checks passed`);
writeFileSync(join(artifacts, "release-check.json"), JSON.stringify({ at: new Date().toISOString(), tarballs: Object.fromEntries(Object.entries(tarballs).map(([n, f]) => [n, relative(root, f)])), results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
