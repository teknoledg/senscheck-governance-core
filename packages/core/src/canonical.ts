import { createHash } from "node:crypto";

const MAX_DEPTH = 32;
const MAX_BYTES = 1_000_000;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function normalize(value: unknown, depth: number, seen: Set<object>): unknown {
  if (depth > MAX_DEPTH) throw new CanonicalizationError("value nested too deeply");
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number");
      return Object.is(value, -0) ? 0 : value;
    case "object":
      break;
    default:
      throw new CanonicalizationError(`unsupported value type: ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizationError("circular reference");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => {
        if (item === undefined) throw new CanonicalizationError("undefined inside array");
        return normalize(item, depth + 1, seen);
      });
    }
    if (!isPlainObject(obj)) throw new CanonicalizationError("only plain JSON objects are allowed");
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const item = obj[key];
      if (item === undefined) continue; // dropped, as JSON.stringify would
      out[key] = normalize(item, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Deterministic JSON: sorted keys, JSON-only values. Throws CanonicalizationError otherwise. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(normalize(value, 0, new Set()));
  if (Buffer.byteLength(json) > MAX_BYTES) throw new CanonicalizationError("value too large");
  return json;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Deep clone through canonical JSON, then freeze. The result shares nothing with the input. */
export function cloneFrozen<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value)) as T;
  return deepFreeze(copy);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
