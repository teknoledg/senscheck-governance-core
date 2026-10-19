import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { canonicalJson, sha256Hex, verifyReceipt } from "@senscheck/governance-core";

/**
 * Offline verification of a SensCheck platform proof bundle (receipt proof or chain attestation).
 * This verifier is open source on purpose: an auditor can check a proof without trusting the vendor's software.
 * It proves the holder of the given public key signed this exact record. It cannot prove the key is the vendor's:
 * confirm the fingerprint against an out-of-band source (the contract, the vendor's website) with --fingerprint.
 */
export interface ProofVerification {
  valid: boolean;
  kind: string;
  errors: string[];
  summary: string[];
  keyFingerprint?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function verifyProofBundle(bundle: unknown, publicKeyPem: string, expectedFingerprint?: string): ProofVerification {
  const errors: string[] = [];
  const summary: string[] = [];
  if (!isRecord(bundle)) return { valid: false, kind: "unknown", errors: ["bundle must be a JSON object"], summary };
  const kind = typeof bundle["kind"] === "string" ? bundle["kind"] : "unknown";

  let key;
  let keyFingerprint: string | undefined;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") errors.push("public key must be Ed25519");
    keyFingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
    if (expectedFingerprint !== undefined && expectedFingerprint.toLowerCase() !== keyFingerprint) {
      errors.push(`public key fingerprint ${keyFingerprint} does not match the expected ${expectedFingerprint}`);
    }
  } catch {
    errors.push("public key is not a valid PEM");
  }

  if (bundle["version"] !== 1) errors.push("unsupported proof version");
  const sig = bundle["signature"];
  if (!isRecord(sig) || sig["alg"] !== "Ed25519" || typeof sig["value"] !== "string" || typeof sig["keyId"] !== "string") {
    errors.push("signature missing or not Ed25519");
  }
  const str = (k: string): string => (typeof bundle[k] === "string" ? (bundle[k] as string) : "");
  const num = (k: string): number => (typeof bundle[k] === "number" && Number.isInteger(bundle[k]) ? (bundle[k] as number) : -1);

  let message = "";
  if (kind === "receipt-proof") {
    const seq = num("seq");
    if (!str("tenantId") || seq < 1 || !str("hash") || !str("prevHash") || !str("storedAt")) errors.push("receipt proof is missing fields");
    const receipt = bundle["receipt"];
    const rv = verifyReceipt(receipt);
    if (!rv.valid) errors.push(...rv.errors.map((e) => `receipt: ${e}`));
    else if (sha256Hex(`${str("prevHash")}\n${canonicalJson(receipt)}`) !== str("hash")) {
      errors.push("receipt does not match its chain hash: the receipt or its position was altered");
    }
    message = `senscheck-proof-v1\ntenant:${str("tenantId")}\nseq:${seq}\nhash:${str("hash")}\nstoredAt:${str("storedAt")}`;
    summary.push(`receipt #${seq} of tenant ${str("tenantId")}, stored ${str("storedAt")}`);
    if (rv.valid) summary.push(`decision ${(receipt as { decision: string }).decision}`);
  } else if (kind === "chain-attestation") {
    const count = num("count");
    if (!str("tenantId") || count < 0 || !str("headHash") || !str("at")) errors.push("attestation is missing fields");
    message = `senscheck-attest-v1\ntenant:${str("tenantId")}\ncount:${count}\nhead:${str("headHash")}\nat:${str("at")}`;
    summary.push(`chain of ${count} receipts for tenant ${str("tenantId")}, head ${str("headHash").slice(0, 16)}…, attested ${str("at")}`);
  } else {
    errors.push(`unknown proof kind: ${kind}`);
  }

  if (errors.length === 0 && key !== undefined && isRecord(sig)) {
    let ok = false;
    try {
      ok = edVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig["value"] as string, "base64"));
    } catch {
      ok = false;
    }
    if (!ok) errors.push("signature does not verify against this public key");
  }
  return { valid: errors.length === 0, kind, errors, summary, ...(keyFingerprint === undefined ? {} : { keyFingerprint }) };
}
