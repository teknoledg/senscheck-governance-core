import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson, wrapFunction, type Principal, type RiskLevel, type SensCheckGovernance } from "@senscheck/governance-core";

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

/**
 * Absolute path with symlinks resolved. Nonexistent tails (a file about to be created) are re-attached to the
 * nearest existing ancestor's real path, so a symlinked directory cannot be used to escape an allowlist, and on
 * case-insensitive filesystems the on-disk casing is used. Falls back to the lexical path if nothing resolves.
 */
export function canonicalPath(path: string): string {
  const abs = resolve(path);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...tail);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

export interface FsLike {
  writeFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  appendFile(path: string, data: string | Uint8Array, options?: unknown): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
}

/**
 * Governed filesystem mutations. Pass `fs/promises` (or any compatible object). Reads are not wrapped:
 * keep using your fs for reads. Each path is governed both as written (absolute) and with symlinks followed (see canonicalPath), so `a/../b` aliases and symlinked directories cannot dodge policy. A symlink swapped in after the check is a residual race.
 * Resources look like `file:/abs/path`.
 */
export function governFs(fs: FsLike, o: GovernedAdapterOptions) {
  const g = o.governance;

  /**
   * One effect per distinct resource, nested so every one must ALLOW before `run` executes. Each path is governed as
   * written (absolute, lexical) AND as its real location, so a policy written against `/etc/*` still applies where
   * `/etc` is a symlink (macOS) and a policy written against the real path still applies to a symlink into it.
   */
  const govern =
    <A extends unknown[], R>(
      run: (...args: A) => Promise<R>,
      spec: { verb: string; risk: RiskLevel; paths: (...args: A) => string[]; parameters: (...args: A) => Record<string, unknown> },
    ) =>
    (...args: A): Promise<R> => {
      let resources: string[];
      try {
        resources = [...new Set(spec.paths(...args).flatMap((p) => [`file:${resolve(p)}`, `file:${canonicalPath(p)}`]))];
      } catch (err) {
        // Not a usable path: let the engine fail closed with an INVALID_EFFECT receipt.
        return wrapFunction<A, R>(g, run, {
          principal: o.principal, verb: spec.verb, risk: spec.risk, resource: () => { throw err; }, parameters: spec.parameters,
        })(...args);
      }
      let fn = run;
      for (const resource of [...resources].reverse()) {
        fn = wrapFunction<A, R>(g, fn, { principal: o.principal, verb: spec.verb, risk: spec.risk, resource, parameters: spec.parameters });
      }
      return fn(...args);
    };

  return {
    writeFile: govern<[string, string | Uint8Array, unknown?], void>((path, data, opts) => fs.writeFile(path, data, opts), {
      verb: "WRITE",
      risk: "MEDIUM",
      paths: (path) => [path],
      parameters: (path, data) => ({ path: canonicalPath(path), content: dataDigest(data) }),
    }),
    appendFile: govern<[string, string | Uint8Array, unknown?], void>((path, data, opts) => fs.appendFile(path, data, opts), {
      verb: "APPEND",
      risk: "MEDIUM",
      paths: (path) => [path],
      parameters: (path, data) => ({ path: canonicalPath(path), content: dataDigest(data) }),
    }),
    rm: govern<[string, { recursive?: boolean; force?: boolean }?], void>((path, opts) => fs.rm(path, opts), {
      verb: "DELETE",
      risk: "HIGH",
      paths: (path) => [path],
      parameters: (path, opts) => ({ path: canonicalPath(path), recursive: opts?.recursive === true }),
    }),
    // Both ends are governed: the destination is a resource too, so an allowlist on the source cannot be used to
    // move files somewhere policy would never allow.
    rename: govern<[string, string], void>((from, to) => fs.rename(from, to), {
      verb: "MOVE",
      risk: "MEDIUM",
      paths: (from, to) => [from, to],
      parameters: (from, to) => ({ from: canonicalPath(from), to: canonicalPath(to) }),
    }),
    mkdir: govern<[string, { recursive?: boolean }?], unknown>((path, opts) => fs.mkdir(path, opts), {
      verb: "CREATE_DIR",
      risk: "LOW",
      paths: (path) => [path],
      parameters: (path, opts) => ({ path: canonicalPath(path), recursive: opts?.recursive === true }),
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
  run: (file: string, args: string[], options?: { cwd?: string; shell?: boolean | string; env?: Record<string, string | undefined> }) => Promise<R>,
  o: GovernedAdapterOptions & { risk?: RiskLevel },
) {
  return wrapFunction<[string, string[], { cwd?: string; shell?: boolean | string; env?: Record<string, string | undefined> }?], R>(o.governance, run, {
    principal: o.principal,
    verb: "EXECUTE",
    risk: o.risk ?? "HIGH",
    resource: (file) => `process:${file}`,
    // shell and env change what runs (LD_PRELOAD, PATH, shell parsing), so they are bound too. env is bound by digest.
    parameters: (file, args, options) => ({
      file,
      args,
      cwd: options?.cwd ?? null,
      shell: options?.shell ?? false,
      env: options?.env === undefined ? null : sha256(canonicalJson(options.env)),
    }),
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Lower-cased, sorted [name, value] pairs. Anything that is not a plain object, Headers or entry list fails closed. */
function headerEntries(headers: unknown): Array<[string, string]> | null {
  if (headers === undefined || headers === null) return null;
  let pairs: Array<[unknown, unknown]>;
  if (typeof Headers !== "undefined" && headers instanceof Headers) pairs = [...headers.entries()];
  else if (Array.isArray(headers)) pairs = headers as Array<[unknown, unknown]>;
  else if (typeof headers === "object") pairs = Object.entries(headers);
  else throw new Error("unsupported headers type");
  return pairs
    .map(([k, v]): [string, string] => {
      if (typeof k !== "string" || typeof v !== "string") throw new Error("headers must be strings");
      return [k.toLowerCase(), v];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Governed fetch. GET/HEAD/OPTIONS pass straight through; every other method is governed, with headers bound
 * into the effect and `redirect: "error"` forced (a redirect would land the request on an origin policy never saw).
 * Resource: `http:<origin><path>` (query strings are bound in parameters, not the resource).
 * Bodies must be string / Uint8Array / URLSearchParams; anything else fails closed.
 */
export function governFetch<R>(fetchImpl: (url: string, init?: Record<string, unknown>) => Promise<R>, o: GovernedAdapterOptions) {
  const governed = wrapFunction<[string, Record<string, unknown>?], R>(
    o.governance,
    // Governed calls never follow redirects: policy saw one origin, and a 307/308 would replay the body elsewhere.
    (url, init) => fetchImpl(url, { ...init, redirect: "error" }),
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
        return { method, query: u.search, body: bodyDigest, headers: headerEntries(init?.["headers"]) };
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

/**
 * Replace string literals, quoted identifiers and comments with spaces so keyword checks only see code.
 * Returns undefined (=> UNKNOWN) when it cannot be sure: unterminated quote or comment, backslash escapes
 * (dialect dependent), dollar quoting, or MySQL `#` comments.
 */
function stripLiteralsAndComments(sql: string): string | undefined {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return out;
      out += " ";
      i = nl;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return undefined;
      out += " ";
      i = end + 1;
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return undefined;
        const d = sql[j] as string;
        if (d === "\\") return undefined;
        if (d === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out += " ";
      i = j;
    } else if (c === "$" || c === "#") {
      return undefined;
    } else {
      out += c;
    }
  }
  return out;
}

const SIDE_EFFECT_CALL = /\b(pg_\w+|lo_\w+|dblink\w*|nextval|setval|set_config|load_file|sleep|benchmark)\s*\(/i;
const LOCKING_OR_WRITING = /\b(INTO|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|EXEC|FOR\s+(UPDATE|SHARE))\b/i;

/**
 * Conservative classifier: only a single plain SELECT/SHOW/EXPLAIN/DESCRIBE counts as READ. Everything unrecognised
 * is UNKNOWN. Literals and comments are removed with a quote-aware scan first, so `SELECT '--'; DROP TABLE t` is
 * not read as a comment, and a keyword inside a string is not read as code.
 */
export function classifySql(statement: string): SqlClass {
  const code = stripLiteralsAndComments(statement);
  if (code === undefined) return "UNKNOWN";
  const stripped = code.trim().replace(/;\s*$/, "");
  if (stripped.includes(";")) return "UNKNOWN"; // multi-statement
  const keyword = /^[A-Za-z]+/.exec(stripped)?.[0]?.toUpperCase() ?? "";
  if (["SELECT", "SHOW", "EXPLAIN", "DESCRIBE"].includes(keyword)) {
    return LOCKING_OR_WRITING.test(stripped) || SIDE_EFFECT_CALL.test(stripped) ? "UNKNOWN" : "READ";
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
