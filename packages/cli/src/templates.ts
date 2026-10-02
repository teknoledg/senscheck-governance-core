export const SAMPLE_CONFIG = {
  $schema: "./node_modules/@senscheck/governance-core/schema/policy.schema.json",
  version: 1,
  default: "FAIL_CLOSED",
  policyVersion: "2026-10-02",
  resourceDenylist: ["file:/etc/*", "file:/root/*", "file:*/.ssh/*", "file:*/.env*"],
  rules: [
    {
      id: "deny-production-delete",
      description: "Nothing deletes production resources, with or without approval.",
      when: { verb: "DELETE", resource: "production:*" },
      decision: "DENY",
    },
    {
      id: "approve-production-deploy",
      description: "Production deploys always need independent human approval.",
      when: { verb: "DEPLOY", resource: "production:*" },
      decision: "REQUIRE_APPROVAL",
    },
    {
      id: "allow-workspace-writes",
      description: "Writes inside the workspace are allowed (HIGH risk still needs approval).",
      when: { verb: ["WRITE", "APPEND", "CREATE_DIR"], resource: "file:*/workspace/*" },
      decision: "ALLOW",
    },
    {
      id: "allow-staging-deploy",
      when: { verb: "DEPLOY", resource: "staging:*" },
      decision: "ALLOW",
    },
  ],
};

export const EXAMPLE_WRAPPER = `// senscheck.example.mjs: a minimal fail-closed boundary around a destructive function.
// Run: node senscheck.example.mjs
import { readFileSync } from "node:fs";
import {
  SensCheckGovernance,
  StaticAuthorityProvider,
  StaticApprovalProvider,
  GovernanceBlockedError,
} from "@senscheck/governance-core";
import { FileReceiptSink } from "@senscheck/governance-core/node";

const policy = JSON.parse(readFileSync(new URL("./senscheck.config.json", import.meta.url), "utf8"));
const agent = { id: "my-agent", type: "agent" };

const approvals = new StaticApprovalProvider(); // only YOUR code (a human-facing UI/CLI) may call approvals.approve()
const governance = new SensCheckGovernance({
  policies: [policy],
  // Authority comes from the operator, never from the agent. Replace with your real source.
  authorityProvider: new StaticAuthorityProvider([
    {
      principalId: agent.id,
      verbs: ["*"],
      resources: ["*"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      grantedBy: { id: "operator", type: "human" },
    },
  ]),
  approvalProvider: approvals,
  receiptSink: new FileReceiptSink(".senscheck/receipts.jsonl"),
  defaultPrincipal: agent,
  timeout: 2000,
});

async function deleteDirectory({ path }) {
  console.log("(pretend) deleting", path);
}

export const safeDelete = governance.wrapFunction(deleteDirectory, {
  verb: "DELETE",
  resource: ({ path }) => \`file:\${path}\`,
  risk: "HIGH",
});

try {
  await safeDelete({ path: "/workspace/build" });
} catch (err) {
  if (err instanceof GovernanceBlockedError) {
    console.log("blocked:", err.decision, err.reasonCodes.join(","));
  } else {
    throw err;
  }
}
`;

export const GITIGNORE_LINES = [".senscheck/"];
