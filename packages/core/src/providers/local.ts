import { globMatchAny } from "../policy/glob.js";
import type {
  ApprovalProvider,
  ApprovalRequest,
  ApprovalResponse,
  AuthorityProvider,
  AuthorityRequest,
  AuthorityResponse,
  GovernanceReceipt,
  ReceiptSink,
} from "../types.js";

/** Bounded in-memory receipt store. Default sink; also handy in tests. */
export class MemoryReceiptSink implements ReceiptSink {
  readonly receipts: GovernanceReceipt[] = [];
  constructor(private readonly limit = 1000) {}
  write(receipt: GovernanceReceipt): void {
    this.receipts.push(receipt);
    if (this.receipts.length > this.limit) this.receipts.shift();
  }
}

/** Writes one JSON line per receipt. Defaults to stderr so stdout stays clean for MCP stdio servers. */
export class ConsoleReceiptSink implements ReceiptSink {
  constructor(private readonly out: (line: string) => void = (line) => process.stderr.write(`${line}\n`)) {}
  write(receipt: GovernanceReceipt): void {
    this.out(JSON.stringify(receipt));
  }
}

export interface StaticGrant {
  principalId: string;
  /** Glob patterns. Omitted = no verbs granted. There is no implicit wildcard. */
  verbs: string[];
  resources: string[];
  /** ISO time. Required. */
  expiresAt: string;
  grantedBy: { id: string; type: string };
  /** Bind the grant to one exact effect digest (single-effect grant). */
  effectDigest?: string;
}

/**
 * Authority from a fixed list of grants configured by the operator in code.
 * The agent must never be able to add to this list.
 */
export class StaticAuthorityProvider implements AuthorityProvider {
  constructor(
    private readonly grants: readonly StaticGrant[],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  check(req: AuthorityRequest): AuthorityResponse {
    const { effect } = req;
    const now = this.clock().toISOString();
    const grant = this.grants.find(
      (g) =>
        g.principalId === effect.principal.id &&
        globMatchAny(g.verbs, effect.action.verb) &&
        globMatchAny(g.resources, effect.action.resource) &&
        (g.effectDigest === undefined || g.effectDigest === req.effectDigest),
    );
    if (grant === undefined) {
      return {
        status: "NOT_GRANTED",
        principalId: effect.principal.id,
        grantedBy: { id: "static-authority", type: "system" },
        observedAt: now,
        expiresAt: now,
      };
    }
    return {
      status: "GRANTED",
      principalId: grant.principalId,
      grantedBy: grant.grantedBy,
      observedAt: now,
      expiresAt: grant.expiresAt,
      ...(grant.effectDigest === undefined ? {} : { effectDigest: grant.effectDigest }),
    };
  }
}

/**
 * Authority from process environment variables set by the operator before the agent starts:
 *   SENSCHECK_AUTHORIZED_PRINCIPALS=agent-a,agent-b
 *   SENSCHECK_AUTHORITY_EXPIRES=2026-12-31T00:00:00Z   (required)
 *   SENSCHECK_AUTHORITY_GRANTED_BY=ops-oncall          (optional, default "operator")
 * Weak by design: any code that can set env vars in this process can grant itself authority.
 */
export class EnvironmentAuthorityProvider implements AuthorityProvider {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  check(req: AuthorityRequest): AuthorityResponse {
    const now = this.clock().toISOString();
    const principals = (this.env["SENSCHECK_AUTHORIZED_PRINCIPALS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const expires = this.env["SENSCHECK_AUTHORITY_EXPIRES"];
    const granted = expires !== undefined && principals.includes(req.effect.principal.id);
    return {
      status: granted ? "GRANTED" : "NOT_GRANTED",
      principalId: req.effect.principal.id,
      grantedBy: { id: this.env["SENSCHECK_AUTHORITY_GRANTED_BY"] ?? "operator", type: "human" },
      observedAt: now,
      expiresAt: expires ?? now,
    };
  }
}

export interface RecordedApproval {
  effectDigest: string;
  approver: { id: string; type: string };
  approvedAt: string;
  expiresAt: string;
  approvalId: string;
}

/**
 * In-memory approvals recorded by operator-controlled code (a CLI prompt, a review UI, a ticket webhook).
 * Never expose `approve` to the governed agent.
 */
export class StaticApprovalProvider implements ApprovalProvider {
  private readonly approvals = new Map<string, RecordedApproval>();
  private readonly rejected = new Set<string>();
  private counter = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  approve(effectDigest: string, approver: { id: string; type: string }, ttlMs = 15 * 60_000): RecordedApproval {
    const now = this.clock();
    const record: RecordedApproval = {
      effectDigest,
      approver,
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      approvalId: `appr_${++this.counter}_${effectDigest.slice(0, 12)}`,
    };
    this.approvals.set(effectDigest, record);
    this.rejected.delete(effectDigest);
    return record;
  }

  reject(effectDigest: string): void {
    this.approvals.delete(effectDigest);
    this.rejected.add(effectDigest);
  }

  check(req: ApprovalRequest): ApprovalResponse {
    if (this.rejected.has(req.effectDigest)) return { status: "REJECTED" };
    const record = this.approvals.get(req.effectDigest);
    if (record === undefined) return { status: "PENDING" };
    return { status: "APPROVED", ...record };
  }
}

/** Delegates to a function you supply (prompt a human, call a ticketing system, ...). */
export class CallbackApprovalProvider implements ApprovalProvider {
  constructor(private readonly fn: (req: ApprovalRequest) => Promise<ApprovalResponse> | ApprovalResponse) {}
  check(req: ApprovalRequest): Promise<ApprovalResponse> | ApprovalResponse {
    return this.fn(req);
  }
}
