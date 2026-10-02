import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { isIsoTime } from "./effect.js";
import type { GovernanceDecision, GovernanceReceipt, ReceiptPhase } from "./types.js";

export interface ReceiptInput {
  effectId: string;
  effectDigest: string | null;
  principalId: string;
  decision: GovernanceDecision;
  reasonCodes: string[];
  authorized: boolean;
  attempted: boolean;
  occurred: boolean;
  phase: ReceiptPhase;
  evaluatedAt: string;
  policyVersion: string;
  metadata?: Record<string, unknown>;
}

function digestOf(receipt: Omit<GovernanceReceipt, "integrity">): string {
  return sha256Hex(canonicalJson(receipt));
}

/**
 * Build a receipt with an unkeyed sha256 integrity digest.
 * The digest detects accidental or naive edits. It is NOT a signature: anyone who can rewrite
 * the receipt can recompute it. Store receipts somewhere the governed agent cannot write.
 */
export function createReceipt(input: ReceiptInput): GovernanceReceipt {
  const body: Omit<GovernanceReceipt, "integrity"> = {
    receiptVersion: "1.0",
    receiptId: `rcpt_${randomUUID()}`,
    effectId: input.effectId,
    effectDigest: input.effectDigest,
    principalId: input.principalId,
    decision: input.decision,
    reasonCodes: [...input.reasonCodes],
    authorized: input.authorized,
    attempted: input.attempted,
    occurred: input.occurred,
    phase: input.phase,
    evaluatedAt: input.evaluatedAt,
    policyVersion: input.policyVersion,
    metadata: input.metadata ?? {},
  };
  return { ...body, integrity: { algorithm: "sha256", digest: digestOf(body) } };
}

export interface ReceiptVerification {
  valid: boolean;
  errors: string[];
}

const DECISIONS = ["ALLOW", "DENY", "FAIL_CLOSED", "REQUIRE_APPROVAL"];
const PHASES = ["DECIDED", "AUTHORIZED", "COMPLETED", "FAILED"];

/** Structural + integrity-digest check. Proves internal consistency only, not authenticity. */
export function verifyReceipt(input: unknown): ReceiptVerification {
  const errors: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["receipt must be an object"] };
  }
  const r = input as Record<string, unknown>;
  if (r["receiptVersion"] !== "1.0") errors.push("receiptVersion must be \"1.0\"");
  for (const key of ["receiptId", "effectId", "principalId", "policyVersion"]) {
    if (typeof r[key] !== "string" || r[key] === "") errors.push(`${key} must be a non-empty string`);
  }
  if (r["effectDigest"] !== null && typeof r["effectDigest"] !== "string") errors.push("effectDigest invalid");
  if (!DECISIONS.includes(r["decision"] as string)) errors.push("decision invalid");
  if (!PHASES.includes(r["phase"] as string)) errors.push("phase invalid");
  if (!Array.isArray(r["reasonCodes"]) || !r["reasonCodes"].every((c) => typeof c === "string")) {
    errors.push("reasonCodes must be a string array");
  }
  for (const key of ["authorized", "attempted", "occurred"]) {
    if (typeof r[key] !== "boolean") errors.push(`${key} must be boolean`);
  }
  if (!isIsoTime(r["evaluatedAt"])) errors.push("evaluatedAt invalid");
  if (r["metadata"] === null || typeof r["metadata"] !== "object" || Array.isArray(r["metadata"])) {
    errors.push("metadata must be an object");
  }
  if (r["occurred"] === true && r["attempted"] !== true) errors.push("occurred without attempted");
  if (r["decision"] !== "ALLOW" && (r["authorized"] === true || r["attempted"] === true)) {
    errors.push("non-ALLOW receipt claims authorization or attempt");
  }

  const integrity = r["integrity"] as { algorithm?: unknown; digest?: unknown } | undefined;
  if (integrity === undefined || integrity === null || integrity.algorithm !== "sha256" || typeof integrity.digest !== "string") {
    errors.push("integrity missing or invalid");
  } else if (errors.length === 0) {
    const { integrity: _omit, ...body } = r;
    void _omit;
    try {
      if (digestOf(body as Omit<GovernanceReceipt, "integrity">) !== integrity.digest) {
        errors.push("integrity digest mismatch: receipt was modified");
      }
    } catch {
      errors.push("receipt not canonicalizable");
    }
  }
  return { valid: errors.length === 0, errors };
}
