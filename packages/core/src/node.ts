import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ApprovalProvider, ApprovalRequest, ApprovalResponse, GovernanceReceipt, ReceiptSink } from "./types.js";

/** Append-only JSON Lines receipts. Put the file where the governed agent cannot write or delete. */
export class FileReceiptSink implements ReceiptSink {
  constructor(private readonly path: string) {}

  async write(receipt: GovernanceReceipt): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export async function readReceiptFile(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

/**
 * Asks a human at the terminal. The approver identity is the one YOU pass in (e.g. the logged-in OS user),
 * recorded as type "human". Only use in an interactive process the agent cannot type into.
 */
export class TerminalApprovalProvider implements ApprovalProvider {
  constructor(
    private readonly approver: { id: string },
    private readonly ttlMs = 15 * 60_000,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async check(req: ApprovalRequest): Promise<ApprovalResponse> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const e = req.effect;
      const answer = await rl.question(
        `\nSensCheck approval required\n  principal: ${e.principal.id}\n  action:    ${e.action.verb} ${e.action.resource}\n  risk:      ${e.risk}\n  digest:    ${req.effectDigest.slice(0, 16)}…\nApprove? (type "yes" to approve) `,
      );
      if (answer.trim().toLowerCase() !== "yes") return { status: "REJECTED" };
      const now = this.clock();
      return {
        status: "APPROVED",
        approver: { id: this.approver.id, type: "human" },
        approvedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
        effectDigest: req.effectDigest,
        approvalId: `term_${req.effectDigest.slice(0, 12)}_${now.getTime()}`,
      };
    } finally {
      rl.close();
    }
  }
}
