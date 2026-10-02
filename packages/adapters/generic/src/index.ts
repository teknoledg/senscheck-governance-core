import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { wrapFunction, type Principal, type RiskLevel, type SensCheckGovernance } from "@senscheck/governance-core";

export interface GovernedAdapterOptions {
  governance: SensCheckGovernance;
  /** Fixed by you. Never derive the principal from tool input. */
  principal: Principal;
}

const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

function dataDigest(data: unknown): { sha256: string; bytes: number } {
  if (typeof data === "string") return { sha256: sha256(data), bytes: Buffer.byteLength(data) };
  if (data instanceof Uint8Array) return { sha256: sha256(data), bytes: data.byteLength };
  throw new Error("unsupported data type: only string or Uint8Array can be bound to an effect");
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export interface FsLike {
  writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  appendFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
}

/**
 * Governed filesystem mutations. Pass `fs/promises` (or any compatible object). Reads are not wrapped:
 * keep using your fs for reads. Paths are resolved to absolute form so `a/../b` aliases cannot dodge policy.
 * Resources look like `file:/abs/path`.
 */
export function governFs(fs: FsLike, o: GovernedAdapterOptions) {
  const g = o.governance;
  const base = { principal: o.principal };
  return {
    writeFile: wrapFunction<[string, string | Uint8Array, unknown?], void>(g, (path, data, opts) => fs.writeFile(path, data, opts), {
      ...base,
      verb: "WRITE",
      risk: "MEDIUM",
      resource: (path) => `file:${resolve(path)}`,
      parameters: (path, data) => ({ path: resolve(path), content: dataDigest(data) }),
    }),
    appendFile: wrapFunction<[string, string | Uint8Array, unknown?], void>(g, (path, data, opts) => fs.appendFile(path, data, opts), {
      ...base,
      verb: "APPEND",
      risk: "MEDIUM",
      resource: (path) => `file:${resolve(path)}`,
      parameters: (path, data) => ({ path: resolve(path), content: dataDigest(data) }),
    }),
    rm: wrapFunction<[string, { recursive?: boolean; force?: boolean }?], void>(g, (path, opts) => fs.rm(path, opts), {
      ...base,
      verb: "DELETE",
      risk: "HIGH",
      resource: (path) => `file:${resolve(path)}`,
      parameters: (path: string, opts?: { recursive?: boolean; force?: boolean }) => ({ path: resolve(path), recursive: opts?.recursive === true }),
    }),
    rename: wrapFunction(g, (from: string, to: string) => fs.rename(from, to), {
      ...base,
      verb: "MOVE",
      risk: "MEDIUM",
      resource: (from) => `file:${resolve(from)}`,
      parameters: (from, to) => ({ from: resolve(from), to: resolve(to) }),
    }),
    mkdir: wrapFunction<[string, { recursive?: boolean }?], unknown>(g, (path, opts) => fs.mkdir(path, opts), {
      ...base,
      verb: "CREATE_DIR",
      risk: "LOW",
      resource: (path) => `file:${resolve(path)}`,
      parameters: (path: string, opts?: { recursive?: boolean }) => ({ path: resolve(path), recursive: opts?.recursive === true }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Process / shell
// ---------------------------------------------------------------------------

/**
 * Govern a process runner such as a promisified `execFile`. Resource: `process:<file>`.
 * There is deliberately no helper for shell strings: `sh -c "<model text>"` cannot be bound to a meaningful effect.
 * If you must, pass the shell as `file` and the string in `args`, and require approval for it in policy.
 */
export function governProcess<R>(
  run: (file: string, args: string[], options?: { cwd?: string }) => Promise<R>,
  o: GovernedAdapterOptions & { risk?: RiskLevel },
) {
  return wrapFunction<[string, string[], { cwd?: string }?], R>(o.governance, run, {
    principal: o.principal,
    verb: "EXECUTE",
    risk: o.risk ?? "HIGH",
    resource: (file) => `process:${file}`,
    parameters: (file, args, options) => ({ file, args, cwd: options?.cwd ?? null }),
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Governed fetch. GET/HEAD/OPTIONS pass straight through; every other method is governed.
 * Resource: `http:<origin><path>` (query strings are bound in parameters, not the resource).
 * Bodies must be string / Uint8Array / URLSearchParams; anything else fails closed.
 */
export function governFetch<R>(fetchImpl: (url: string, init?: Record<string, unknown>) => Promise<R>, o: GovernedAdapterOptions) {
  const governed = wrapFunction<[string, Record<string, unknown>?], R>(
    o.governance,
    (url, init) => fetchImpl(url, init),
    {
      principal: o.principal,
      verb: "HTTP_MUTATE",
      risk: "MEDIUM",
      resource: (url: string) => {
        const u = new URL(url);
        return `http:${u.origin}${u.pathname}`;
      },
      parameters: (url: string, init?: Record<string, unknown>) => {
        const u = new URL(url);
        const method = String(init?.["method"] ?? "GET").toUpperCase();
        const body = init?.["body"];
        let bodyDigest: ReturnType<typeof dataDigest> | null = null;
        if (body !== undefined && body !== null) {
          bodyDigest = dataDigest(body instanceof URLSearchParams ? body.toString() : (body as string | Uint8Array));
        }
        return { method, query: u.search, body: bodyDigest };
      },
    },
  );
  return (url: string, init?: Record<string, unknown> & { method?: string }): Promise<R> => {
    const method = String(init?.method ?? "GET").toUpperCase();
    return SAFE_METHODS.has(method) ? fetchImpl(url, init) : (governed(url, init) as Promise<R>);
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export type SqlClass = "READ" | "WRITE" | "DESTRUCTIVE" | "UNKNOWN";

/** Conservative classifier: only a single plain SELECT/SHOW/EXPLAIN/DESCRIBE counts as READ. Everything unrecognised is UNKNOWN. */
export function classifySql(statement: string): SqlClass {
  const stripped = statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (stripped.includes(";")) return "UNKNOWN"; // multi-statement
  const keyword = /^[A-Za-z]+/.exec(stripped)?.[0]?.toUpperCase() ?? "";
  if (["SELECT", "SHOW", "EXPLAIN", "DESCRIBE"].includes(keyword)) {
    return /\b(INTO|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|EXEC)\b/i.test(stripped) ? "UNKNOWN" : "READ";
  }
  if (["INSERT", "UPDATE", "MERGE", "REPLACE", "CREATE"].includes(keyword)) return "WRITE";
  if (["DELETE", "DROP", "TRUNCATE", "ALTER", "GRANT", "REVOKE"].includes(keyword)) return "DESTRUCTIVE";
  return "UNKNOWN";
}

/**
 * Governed SQL runner. READ statements pass through; everything else is governed.
 * Resource: `db:<database>`; the statement text and params are bound in parameters.
 * This is a convenience classifier, not a SQL parser: use database permissions as the real boundary.
 */
export function governSql<R>(
  run: (statement: string, params?: unknown[]) => Promise<R>,
  o: GovernedAdapterOptions & { database: string },
) {
  const risks: Record<Exclude<SqlClass, "READ">, { verb: string; risk: RiskLevel }> = {
    WRITE: { verb: "DB_WRITE", risk: "MEDIUM" },
    DESTRUCTIVE: { verb: "DB_DESTRUCTIVE", risk: "HIGH" },
    UNKNOWN: { verb: "DB_UNCLASSIFIED", risk: "HIGH" },
  };
  const wrapped = (cls: Exclude<SqlClass, "READ">) =>
    wrapFunction(o.governance, run, {
      principal: o.principal,
      ...risks[cls],
      resource: `db:${o.database}`,
      parameters: (statement, params) => ({ statement, params: params ?? [] }),
    });
  const byClass = { WRITE: wrapped("WRITE"), DESTRUCTIVE: wrapped("DESTRUCTIVE"), UNKNOWN: wrapped("UNKNOWN") };
  return (statement: string, params?: unknown[]): Promise<R> => {
    const cls = classifySql(statement);
    return cls === "READ" ? run(statement, params) : (byClass[cls](statement, params) as Promise<R>);
  };
}
