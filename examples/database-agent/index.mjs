// Governed SQL: reads pass through, writes are governed, destructive/unknown statements need approval.
import { governSql } from "@senscheck/generic-tools";
import { GovernanceBlockedError } from "@senscheck/governance-core";
import { agent, assert, build, line } from "../_shared.mjs";

const executed = [];
const fakeDb = async (sql, params = []) => {
  executed.push(sql);
  return { rows: [], sql, params };
};
const { governance } = build({
  version: 1,
  default: "FAIL_CLOSED",
  rules: [
    { id: "allow-writes-to-app-db", when: { verb: "DB_WRITE", resource: "db:app" }, decision: "ALLOW" },
    { id: "deny-everything-on-billing", when: { resource: "db:billing" }, decision: "DENY" },
  ],
});
const app = governSql(fakeDb, { governance, principal: agent, database: "app" });
const billing = governSql(fakeDb, { governance, principal: agent, database: "billing" });

await app("SELECT * FROM users");
line("SELECT", "passes through");
await app("INSERT INTO notes (body) VALUES (?)", ["hi"]);
line("INSERT on app", "ALLOW");

for (const [label, run] of [
  ["DROP TABLE users", () => app("DROP TABLE users")],
  ["UPDATE on billing", () => billing("UPDATE invoices SET paid = 1")],
  ["multi-statement", () => app("SELECT 1; DELETE FROM users")],
]) {
  try {
    await run();
    assert(false, `${label} must be blocked`);
  } catch (err) {
    assert(err instanceof GovernanceBlockedError, "expected a governance block");
    line(label, `${err.decision} [${err.reasonCodes.join(",")}]`);
  }
}
assert(executed.length === 2, `only the SELECT and INSERT may reach the database (got ${executed.length})`);
