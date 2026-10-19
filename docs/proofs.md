# Verifying platform proofs

Business-plan tenants of the SensCheck Platform can download **proofs**: JSON documents signed by a key the customer does not hold. The verifier is open source and offline, so an auditor does not have to trust the vendor's software.

```bash
senscheck verify-proof proof.json --public-key platform-key.pem --fingerprint <sha256-from-an-out-of-band-source>
```

Exit code `0` = valid, `1` = invalid, `2` = usage or I/O error.

## What a valid proof establishes

- The holder of the given private key signed this exact record (tenant, position, hash and storage time).
- For a receipt proof: the receipt's contents match its chain hash, so neither the receipt nor its position in the tenant's chain was changed after signing.
- For a chain attestation: the platform vouched for a chain of this length with this head hash at the stated time.

## What it does not establish

- **That the key is the vendor's.** Obtain the public key from `GET /v1/keys` and confirm its fingerprint from a source you trust independently (your contract, the vendor's website). Without `--fingerprint` the verifier says so.
- **That the action happened.** A receipt records what governance decided and what the wrapper attempted; it is not proof the world changed.
- **Time, beyond the platform's own clock.** `storedAt` is the platform's recorded time. There is no external timestamp authority yet.
- **Hardware custody.** Do not assume the key is in an HSM unless the vendor states it in writing.

## Format (version 1)

Signature: Ed25519 over the UTF-8 message, base64. Messages are domain-separated so one kind can never be replayed as the other.

Receipt proof (`kind: "receipt-proof"`):

```
message = "senscheck-proof-v1\ntenant:<tenantId>\nseq:<seq>\nhash:<hash>\nstoredAt:<storedAt>"
hash    = sha256_hex( prevHash + "\n" + canonicalJson(receipt) )
```

Chain attestation (`kind: "chain-attestation"`):

```
message = "senscheck-attest-v1\ntenant:<tenantId>\ncount:<count>\nhead:<headHash>\nat:<at>"
```

`canonicalJson` is the sorted-key JSON used by `@senscheck/governance-core` (`canonicalJson`). The first receipt's `prevHash` is 64 zeros.

Fields: `version` (1), `kind`, `tenantId`, `seq`/`prevHash`/`hash`/`storedAt`/`receipt` (receipt proof) or `count`/`headHash`/`at` (attestation), and `signature: { alg: "Ed25519", keyId, value }`.

The format is simple on purpose: you can re-implement the check in any language in an afternoon, and `packages/cli/test/cli.test.ts` does exactly that from first principles.
