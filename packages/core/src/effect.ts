import { randomUUID } from "node:crypto";
import { canonicalJson, cloneFrozen, sha256Hex, CanonicalizationError } from "./canonical.js";
import {
  PRINCIPAL_TYPES,
  RISK_LEVELS,
  type CanonicalEffect,
  type Effect,
  type Principal,
  type RiskLevel,
} from "./types.js";

const EFFECT_KEYS = new Set([
  "schemaVersion",
  "effectId",
  "principal",
  "action",
  "parameters",
  "risk",
  "proposedAt",
  "metadata",
]);
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const VERB_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type EffectInput = {
  principal: Principal;
  verb: string;
  resource: string;
  risk: RiskLevel;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  effectId?: string;
  proposedAt?: string;
};

/** Convenience constructor: fills schemaVersion, effectId and proposedAt. Still validated by the engine. */
export function createEffect(input: EffectInput, now: Date = new Date()): Effect {
  return {
    schemaVersion: "1.0",
    effectId: input.effectId ?? `eff_${randomUUID()}`,
    principal: input.principal,
    action: { verb: input.verb, resource: input.resource },
    parameters: input.parameters ?? {},
    risk: input.risk,
    proposedAt: input.proposedAt ?? now.toISOString(),
    metadata: input.metadata ?? {},
  };
}

export function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export type CanonicalizeResult =
  | { ok: true; canonical: CanonicalEffect }
  | { ok: false; errors: string[] };

/**
 * Validate an untrusted effect and return a deep-frozen copy plus its digest.
 * Anything missing, unknown or malformed is an error: nothing is inferred.
 */
export function canonicalizeEffect(input: unknown): CanonicalizeResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["effect must be an object"] };

  for (const key of Object.keys(input)) {
    if (!EFFECT_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }
  if (input["schemaVersion"] !== "1.0") errors.push("schemaVersion must be \"1.0\"");
  const effectId = input["effectId"];
  if (typeof effectId !== "string" || !ID_RE.test(effectId)) errors.push("effectId invalid");

  const principal = input["principal"];
  if (!isRecord(principal)) {
    errors.push("principal missing");
  } else {
    const id = principal["id"];
    if (typeof id !== "string" || id.length === 0 || id.length > 256 || CONTROL_RE.test(id)) {
      errors.push("principal.id invalid");
    }
    if (!(PRINCIPAL_TYPES as readonly unknown[]).includes(principal["type"])) {
      errors.push("principal.type invalid");
    }
    for (const key of Object.keys(principal)) {
      if (key !== "id" && key !== "type") errors.push(`unknown field: principal.${key}`);
    }
  }

  const action = input["action"];
  if (!isRecord(action)) {
    errors.push("action missing");
  } else {
    const verb = action["verb"];
    if (typeof verb !== "string" || !VERB_RE.test(verb)) errors.push("action.verb invalid");
    const resource = action["resource"];
    if (
      typeof resource !== "string" ||
      resource.length === 0 ||
      resource.length > 1024 ||
      CONTROL_RE.test(resource)
    ) {
      errors.push("action.resource invalid");
    }
    for (const key of Object.keys(action)) {
      if (key !== "verb" && key !== "resource") errors.push(`unknown field: action.${key}`);
    }
  }

  if (!(RISK_LEVELS as readonly unknown[]).includes(input["risk"])) errors.push("risk invalid or unknown");
  if (!isIsoTime(input["proposedAt"])) errors.push("proposedAt must be an ISO-8601 timestamp");
  if (!isRecord(input["parameters"])) errors.push("parameters must be an object");
  if (!isRecord(input["metadata"])) errors.push("metadata must be an object");

  if (errors.length > 0) return { ok: false, errors };

  let frozen: Effect;
  let digest: string;
  try {
    frozen = cloneFrozen(input as unknown as Effect);
    digest = effectDigest(frozen);
  } catch (err) {
    const message = err instanceof CanonicalizationError ? err.message : "effect not serializable";
    return { ok: false, errors: [`effect not canonicalizable: ${message}`] };
  }
  return { ok: true, canonical: { effect: frozen, digest } };
}

/** Digest of the material fields. effectId, proposedAt and metadata are deliberately excluded. */
export function effectDigest(effect: Readonly<Effect>): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: effect.schemaVersion,
      principal: effect.principal,
      action: effect.action,
      parameters: effect.parameters,
      risk: effect.risk,
    }),
  );
}

export function riskRank(risk: RiskLevel): number {
  return RISK_LEVELS.indexOf(risk);
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}
