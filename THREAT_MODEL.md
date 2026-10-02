# Threat model

Scope: SensCheck Governance Core and its adapters, as an in-process boundary between an AI agent's *proposal* and a real side effect.

**Assets:** the real-world effect (files, data, deployments, money, access); policy; authority and approval records; receipts.
**Trust boundary:** the governed agent/model and everything it can influence (prompts, tool arguments, effect `parameters`/`metadata`, tool outputs) are **untrusted**. Policy files, providers, the process, and the host are **trusted** (and out of scope if compromised).

| # | Threat | Mitigation in Core | Residual risk |
|---|---|---|---|
| 1 | Agent self-authorization | Authority granted by the principal, or by an agent/model type, is `DENY / SELF_AUTHORIZATION`. Approver must be a human ≠ proposer. Authority/approval only come from provider objects the operator constructs. | If the agent can call `approvals.approve()` or edit provider config, Core cannot tell. Keep those out of agent reach. |
| 2 | Policy bypass | Final gate runs inside `execute`; callback is only reachable on ALLOW. Deny > approval > allow. Config is strictly validated; invalid config throws, never allows. | Code paths that call the raw function. Use `senscheck audit`, `/governance-review`, and un-export raw functions. |
| 3 | Provider timeout | Per-call timeout → `FAIL_CLOSED / *_TIMEOUT`. | The provider's work may continue in the background. |
| 4 | Provider exception | → `FAIL_CLOSED / *_ERROR`. | – |
| 5 | Malformed response | Every response is shape-validated → `FAIL_CLOSED / *_MALFORMED_RESPONSE`. | – |
| 6 | Stale authority | Required `expiresAt`, `observedAt` freshness window, re-check immediately before the effect, expiry re-checked synchronously at the gate. | Clock skew between provider and host (60s tolerance for future timestamps). |
| 7 | TOCTOU authorize→execute | Frozen deep copy of the effect is what runs; authority re-checked; decision age limit; receipt written first. | Time between the final check and the callback's own syscall. |
| 8 | Effect mutated after authorization | Canonicalize into a deep-frozen clone; digest binds principal/action/parameters/risk; approvals and optional authority bind to the digest. | Mutation *inside* the callback of external state it reads. |
| 9 | Configuration manipulation | Strict schema, unknown keys rejected, ALLOW default rejected, copy-on-load. | Anyone who can write the file/process can change policy. Protect it with OS permissions and code review. |
| 10 | Receipt deletion | ALLOW requires the receipt to be written first (`RECEIPT_SINK_FAILURE` blocks the effect). | A sink that later loses data. Receipts are unsigned. Use append-only storage the agent cannot touch. |
| 11 | Alternate unwrapped execution path | Explicit wrappers; `senscheck audit`; `governance-review` skill. | Fundamental to in-process design. |
| 12 | Tool aliasing | Resources are normalized by the wrapper (e.g., `path.resolve`); policy matches the resource, not the tool name. | Wrapper authors must normalize resources. |
| 13 | Nested tool invocation | Each wrapped call is independently governed and receipted. | A governed tool that calls an ungoverned one. |
| 14 | Prompt injection targeting governance | Prose is never policy; unknown effect fields are rejected; `parameters`/`metadata` are not consulted for decisions. | Injection that changes *which effect is proposed* is a policy-design issue: deny by default. |
| 15 | Model claims human approval | Approval is only the provider response, bound to digest, from a human ≠ proposer. | A compromised human channel. |
| 16 | Recursive / sub-agents | Fixed principal per wrapper; sub-agents get their own principal and authority. | Principal reuse. Give each agent its own id. |
| 17 | MCP proxy bypass | `governMcpServer` governs tools registered through the returned object; `tool()` refused; unclassified tools default PRIVILEGED; annotations untrusted by default. | Registering on the raw server. Keep it private. |
| 18 | Replay | `effectId` and `approvalId` single-use per process, including concurrent races. | Multi-process replay (shared store needed). |
| 19 | Receipt forgery | Integrity digest detects naive edits. | Not authenticity: attacker can recompute the digest. |
| 20 | Denial of service via slow providers | Timeouts bound latency; failure is closed. | Availability is traded for safety by design. |

Out of scope: compromised host/process, malicious dependencies, OS-level escapes, physical safety systems.
