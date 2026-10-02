import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface AuditPattern {
  id: string;
  category: string;
  regex: RegExp;
  note: string;
}

const P = (id: string, category: string, regex: RegExp, note: string): AuditPattern => ({ id, category, regex, note });

export const AUDIT_PATTERNS: AuditPattern[] = [
  P("fs-mutation", "filesystem mutation", /\b(writeFile|appendFile|unlink|rmdir|rename|mkdir|copyFile|truncate|createWriteStream)(Sync)?\s*\(|\bfs\.rm(Sync)?\s*\(|\brm(Sync)?\s*\(\s*['"`]/, "writes, deletes or moves files"),
  P("fs-mutation-py", "filesystem mutation", /\b(os\.(remove|unlink|rmdir|rename)|shutil\.(rmtree|move|copy)|open\([^)]*['"][wa]b?\+?['"])/, "writes, deletes or moves files"),
  P("child-process", "process execution", /child_process|\b(execSync|execFileSync|spawnSync)\s*\(|\b(exec|execFile|spawn|fork)\s*\(/, "starts a process"),
  P("child-process-py", "process execution", /\bsubprocess\.|\bos\.system\s*\(|\bos\.popen\s*\(/, "starts a process"),
  P("shell-true", "shell execution", /\bshell\s*:\s*true\b|shell\s*=\s*True/, "executes through a shell"),
  P("sql-write", "database write", /['"`]\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|DATABASE)|TRUNCATE|ALTER\s+TABLE)\b/i, "SQL that mutates data or schema"),
  P("orm-write", "database write", /\.(deleteMany|updateMany|createMany|upsert|destroy|bulkCreate|insertMany|deleteOne|updateOne|findOneAndDelete)\s*\(/, "ORM write call (heuristic)"),
  P("http-mutation", "HTTP mutation", /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i, "HTTP request with a mutating method"),
  P("http-client-mutation", "HTTP mutation", /\b(axios|got|ky|superagent|requests|httpx|client)\.(post|put|patch|delete)\s*\(/, "HTTP client mutating call"),
  P("cloud-mutation", "cloud SDK mutation", /\b(PutObject|DeleteObject|DeleteBucket|TerminateInstances|RunInstances|CreateStack|DeleteStack|UpdateFunctionCode|PublishCommand|SendMessageCommand|SendEmailCommand)(Command)?\b|\.(putObject|deleteObject|terminateInstances|deleteFunction|createFunction)\s*\(/, "cloud API call that changes resources"),
  P("deploy-command", "deployment command", /\b(kubectl|terraform|helm|docker|vercel|wrangler|flyctl|gcloud|aws|az|serverless|pulumi)\s+(apply|destroy|delete|deploy|push|rollout|publish|release|up|run)\b|\bnpm\s+publish\b/, "deployment or release command"),
  P("credential-change", "credential change", /\b(chmod|chown|ssh-keygen|createAccessKey|rotateKey|setPassword|changePassword|resetPassword|revokeToken)\b|ALTER\s+USER|\bGRANT\s+\w+\s+ON\b|process\.env\.[A-Z0-9_]+\s*=[^=]/i, "changes credentials, permissions or secrets"),
  P("fail-open-catch", "FAIL_OPEN", /catch\s*(\([^)]*\))?\s*\{\s*(return\s+true|return\s+\{\s*(allowed|allow|authorized)\s*:\s*true)/, "an error path that grants permission"),
  P("fail-open-promise", "FAIL_OPEN", /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(true|\{\s*return\s+true)/, "an error path that grants permission"),
];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".senscheck", "venv", ".venv", "__pycache__"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py"]);
const MAX_FILE_BYTES = 1_000_000;

export interface AuditFinding {
  file: string;
  line: number;
  id: string;
  category: string;
  note: string;
  snippet: string;
  /** The file mentions @senscheck/*. That does NOT show this call is wrapped. */
  fileMentionsSenscheck: boolean;
}

export interface AuditReport {
  scannedFiles: number;
  findings: AuditFinding[];
  disclaimer: string;
}

export const AUDIT_DISCLAIMER =
  "Static pattern matching only. It finds LIKELY consequential operations; it cannot prove any path is governed or safe, and it misses dynamic and indirect calls. Review each finding, and run senscheck test for behavioural checks.";

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (EXTS.has(extname(entry.name))) {
      yield full;
    }
  }
}

export function auditSource(file: string, text: string): AuditFinding[] {
  const mentions = /@senscheck\//.test(text);
  const findings: AuditFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return;
    for (const p of AUDIT_PATTERNS) {
      if (p.regex.test(line)) {
        findings.push({
          file,
          line: i + 1,
          id: p.id,
          category: p.category,
          note: p.note,
          snippet: trimmed.slice(0, 160),
          fileMentionsSenscheck: mentions,
        });
      }
    }
  });
  return findings;
}

export async function auditPath(root: string): Promise<AuditReport> {
  const info = await stat(root);
  const files: string[] = [];
  if (info.isDirectory()) for await (const f of walk(root)) files.push(f);
  else files.push(root);
  const findings: AuditFinding[] = [];
  for (const file of files) {
    const s = await stat(file);
    if (s.size > MAX_FILE_BYTES) continue;
    const rel = info.isDirectory() ? relative(root, file) : file;
    findings.push(...auditSource(rel, await readFile(file, "utf8")));
  }
  return { scannedFiles: files.length, findings, disclaimer: AUDIT_DISCLAIMER };
}
