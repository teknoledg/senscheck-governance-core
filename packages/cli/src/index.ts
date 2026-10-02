import { readFile, writeFile, access, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { validatePolicyConfig, type GovernanceReceipt } from "@senscheck/governance-core";
import { auditPath } from "./audit.js";
import { explainReceipt } from "./explain.js";
import { defaultIo, type Io } from "./io.js";
import { runSelfTests } from "./selftest.js";
import { EXAMPLE_WRAPPER, GITIGNORE_LINES, SAMPLE_CONFIG } from "./templates.js";

export { auditPath, auditSource, AUDIT_PATTERNS } from "./audit.js";
export { explainReceipt } from "./explain.js";
export { runSelfTests } from "./selftest.js";
export type { Io } from "./io.js";

const USAGE = `senscheck: fail-closed governance for AI agents

Usage:
  senscheck init [--force]                Create senscheck.config.json, an example wrapper, and .gitignore entries
  senscheck audit [path] [--json] [--fail-on-findings]
                                          Statically list likely consequential operations (heuristic)
  senscheck check [config]                Validate a policy configuration (default: senscheck.config.json)
  senscheck test [--config path]          Run fail-closed behavioural tests
  senscheck explain <receipt-file>        Explain a governance receipt (JSON or JSONL)

Exit codes: 0 ok, 1 findings/failures, 2 usage or I/O error.`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(path: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function cmdInit(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { force: { type: "boolean" } }, allowPositionals: false });
  const force = values.force === true;
  const files: Array<[string, string]> = [
    ["senscheck.config.json", `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`],
    ["senscheck.example.mjs", EXAMPLE_WRAPPER],
  ];
  for (const [name, content] of files) {
    const path = join(io.cwd, name);
    if ((await exists(path)) && !force) {
      io.out(`skip    ${name} (exists; use --force to overwrite)`);
    } else {
      await writeFile(path, content, "utf8");
      io.out(`created ${name}`);
    }
  }
  const gi = join(io.cwd, ".gitignore");
  const current = (await exists(gi)) ? await readFile(gi, "utf8") : "";
  const missing = GITIGNORE_LINES.filter((l) => !current.split("\n").includes(l));
  if (missing.length > 0) {
    await appendFile(gi, `${current === "" || current.endsWith("\n") ? "" : "\n"}# senscheck: receipts may contain resource names\n${missing.join("\n")}\n`, "utf8");
    io.out(`updated .gitignore (+ ${missing.join(", ")})`);
  }
  io.out("\nNext:\n  npm install @senscheck/governance-core\n  senscheck check\n  senscheck test\n  node senscheck.example.mjs\n\nStore receipts where the governed agent cannot write or delete them.");
  return 0;
}

async function cmdAudit(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({ args, options: { json: { type: "boolean" }, "fail-on-findings": { type: "boolean" } }, allowPositionals: true });
  const target = resolve(io.cwd, positionals[0] ?? ".");
  let report;
  try {
    report = await auditPath(target);
  } catch (err) {
    io.err(`cannot audit ${target}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const unguarded = report.findings.filter((f) => !f.fileMentionsSenscheck);
  if (values.json === true) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    for (const f of report.findings) {
      io.out(`${f.file}:${f.line}  [${f.category}]${f.fileMentionsSenscheck ? " (file mentions @senscheck)" : ""}\n    ${f.snippet}`);
    }
    io.out(`\nScanned ${report.scannedFiles} files; ${report.findings.length} likely consequential operations (${unguarded.length} in files that never mention @senscheck).`);
    io.out(report.disclaimer);
  }
  return values["fail-on-findings"] === true && unguarded.length > 0 ? 1 : 0;
}

async function cmdCheck(args: string[], io: Io): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const path = resolve(io.cwd, positionals[0] ?? "senscheck.config.json");
  const loaded = await loadJson(path);
  if (!loaded.ok) {
    io.err(`cannot read ${path}: ${loaded.error}`);
    return 2;
  }
  const result = validatePolicyConfig(loaded.value);
  if (!result.valid) {
    io.err(`INVALID ${path}`);
    for (const e of result.errors) io.err(`  - ${e}`);
    io.err("An invalid configuration is never loaded and never falls back to ALLOW.");
    return 1;
  }
  io.out(`OK ${path}: ${result.config.rules.length} rules, default ${result.config.default}`);
  const warnings: string[] = [];
  if (!result.config.rules.some((r) => r.decision === "DENY") && !result.config.resourceDenylist) {
    warnings.push("no DENY rules or resourceDenylist: nothing is explicitly forbidden");
  }
  for (const r of result.config.rules) {
    const w = r.when;
    if (r.decision === "ALLOW" && w.resource === "*" && w.verb === undefined && w.principalId === undefined) {
      warnings.push(`rule "${r.id}" allows every verb on every resource`);
    }
  }
  for (const w of warnings) io.out(`warning: ${w}`);
  return 0;
}

async function cmdTest(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({ args, options: { config: { type: "string" } }, allowPositionals: false });
  const path = resolve(io.cwd, values.config ?? "senscheck.config.json");
  let userPolicy: unknown;
  if (await exists(path)) {
    const loaded = await loadJson(path);
    const valid = loaded.ok ? validatePolicyConfig(loaded.value) : undefined;
    if (!loaded.ok || !valid?.valid) {
      io.err(`config ${path} is invalid or unreadable; run senscheck check. Tests cannot proceed.`);
      return 1;
    }
    userPolicy = loaded.value;
    io.out(`Using ${path}`);
  } else if (values.config !== undefined) {
    io.err(`config ${path} not found`);
    return 2;
  } else {
    io.out("No senscheck.config.json found; running built-in fail-closed tests only.");
  }
  const results = await runSelfTests(userPolicy);
  for (const r of results) {
    io.out(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      expected ${r.expect}, got ${r.actual}; callback ${r.calledCallback ? "RAN" : "did not run"}; ${r.reasonCodes.join(",")}`}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  io.out(`\n${results.length - failed}/${results.length} passed.`);
  return failed === 0 ? 0 : 1;
}

async function cmdExplain(args: string[], io: Io): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const file = positionals[0];
  if (file === undefined) {
    io.err("usage: senscheck explain <receipt-file>");
    return 2;
  }
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, file), "utf8");
  } catch (err) {
    io.err(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const receipts: unknown[] = [];
  try {
    const whole = text.trim();
    if (whole.startsWith("[")) receipts.push(...(JSON.parse(whole) as unknown[]));
    else if (whole.split("\n").length > 1 && !whole.startsWith("{\n") && !whole.startsWith("{ ")) receipts.push(...whole.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown));
    else receipts.push(JSON.parse(whole) as unknown);
  } catch (err) {
    io.err(`not valid JSON/JSONL: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  let bad = 0;
  for (const r of receipts) {
    if (!(r !== null && typeof r === "object")) {
      io.err("entry is not an object");
      bad++;
      continue;
    }
    io.out(explainReceipt(r as GovernanceReceipt));
    io.out("");
  }
  return bad === 0 ? 0 : 1;
}

export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "init":
        return await cmdInit(rest, io);
      case "audit":
        return await cmdAudit(rest, io);
      case "check":
        return await cmdCheck(rest, io);
      case "test":
        return await cmdTest(rest, io);
      case "explain":
        return await cmdExplain(rest, io);
      case "--help":
      case "-h":
      case "help":
        io.out(USAGE);
        return 0;
      default:
        io.err(command === undefined ? USAGE : `unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    io.err(`senscheck: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

