# Editions: what is free, what is paid, and why

> **Safety is free. Convenience, independent proof and accumulated knowledge are paid.**
> Every fail-closed invariant works in the free SDK, in one process, offline. Nothing safety-critical is held back.

## 1. Each tier works on its own

| Tier | Needs | Does not need | Works alone because |
|---|---|---|---|
| **Free: Core SDK** | Node 20+ | An account, a network, any other SensCheck part | The whole boundary runs in your process: canonical effects, policy, authority, approval, final gate, replay guard, receipts. Failure is `FAIL_CLOSED` |
| **Free: Tools and plugins** | Nothing for audit and review; Core for the wrappers and `senscheck test` | A network, the platform | `senscheck audit` and `/governance-review` find fail-open paths and bypasses in any codebase with no runtime dependency. The adapters (`generic-tools`, `-mcp`, `-openai`) are the ready-made way to apply Core |
| **Paid: Platform** | A connector token; Core (or any client that speaks the API and refuses on error) as the place the decision is enforced | The free tools or plugins | A hosted service with its own console and API. Core is the reference enforcement point |

The tiers are cumulative and **reversible**. Dropping back to free loses coordination, not safety: policy is a plain `senscheck.config.json` you can export from the console, receipts export as JSON, and Core keeps enforcing everything locally. There is no lock-in format.

If the platform is unreachable, slow or wrong, Core refuses (`FAIL_CLOSED`). The platform can stop an action; it can never cause one.

## 2. The paid tiers, ordered by how hard they are to replicate

We are explicit about this because you should be. A competent team could build a policy server, an approval queue, a kill switch and a hash-chained log. So the lowest paid tier is priced as convenience, and the higher tiers sell things a team **cannot give itself**.

| Tier | Sells | Could your team build it? | Status |
|---|---|---|---|
| **Team** | **Run it for me.** Operator console, central policy, approval inbox, grants and revocation, per-tenant kill switch, hash-chained receipts, token management, audit of every human action | Yes, in weeks, then you maintain and secure it. You pay to not own that | Built (API and console); not yet deployed |
| **Business** | **Independent proof.** Receipts and chain heads signed by a key held by us, verifiable offline with the open-source `senscheck verify-proof` ([how](proofs.md)). Planned on top: HSM/KMS custody; external timestamping; retention and legal hold; evidence packs mapped to frameworks (for example EU AI Act, SOC 2, ISO 42001); SSO and SCIM | **No, not credibly.** A record you sign yourself proves nothing to an auditor, because you could have rewritten it. Value comes from a third party holding the keys and the clock | Signing and the open verifier are built. **Not yet:** HSM/KMS custody, external timestamping, retention, evidence packs, SSO. Not offered until the custody claim can be made truthfully |
| **Enterprise** | **Knowledge that compounds.** A curated risk registry of agent tools and MCP servers and ready policy packs, updated as the ecosystem changes; opt-in, anonymised failure patterns across customers; an independently audited platform (pen test and SOC 2 reports); SLA; dedicated tenancy and region; identity integration (Akita) | **No.** It needs many customers' data, ongoing research effort, and an outside auditor's signature | Roadmap |

### Why a team cannot just copy the higher tiers

- **Independent proof** is a trust relationship, not a feature. The code to sign a receipt is trivial. The part an auditor accepts is that someone other than you controls the key, the clock and the retention.
- **Accumulated knowledge** improves with every deployment we see and every tool we review. A team sees only its own agents.
- **Assurance** (audit reports, SLAs, key custody, incident response) is a service we run, not software you can fork.

## 3. When to pay

**Stay free if** one team runs one service, a developer is the approver, and a policy file under version control is your change process. Core does the whole job.

| You hit this | Move to |
|---|---|
| Several services or teams, and policy must change in one place; approvers who are not developers; you need to stop everything now | Team |
| A customer, auditor or regulator asks for records you cannot have altered, or for compliance evidence | Business |
| You run many agents and tools you did not write, need ongoing risk intelligence, or must show an audited vendor | Enterprise |

## 4. Rules that keep the tiers honest

1. **No safety feature is paywalled.** If removing the platform weakens an invariant, that is a Core bug, not an upsell.
2. **Nothing paid is required to use anything free.** Core makes no network calls and has no telemetry, with or without the platform.
3. **A feature belongs in the platform only if** it needs shared state, other people, infrastructure we operate, a third-party trust position, or knowledge gathered across customers. If it is a pure function of one effect, it belongs in Core.
4. **We claim only what is built.** The status column is part of the claim.
5. **Tools and plugins stay free.** Adoption is the product's first job.
6. **You can leave.** Export policy and receipts at any time; Core enforces the same rules without us.
