// Validates the three JSON Schemas compile, and that they agree with the runtime validators on fixtures.
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { validatePolicyConfig, createEffect, canonicalizeEffect, SensCheckGovernance, MemoryReceiptSink, verifyReceipt } from "../packages/core/dist/index.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } });
const load = (n) => JSON.parse(readFileSync(new URL(`../packages/core/schema/${n}.schema.json`, import.meta.url), "utf8"));
const policy = ajv.compile(load("policy"));
const effectSchema = ajv.compile(load("effect"));
const receiptSchema = ajv.compile(load("receipt"));
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failures++; };

const rule = (extra) => ({ id: "r", when: { verb: "X" }, decision: "DENY", ...extra });
const policyFixtures = [
  [{ version: 1, default: "DENY", rules: [] }, true],
  [{ version: 1, default: "FAIL_CLOSED", rules: [rule({}), { id: "a", when: { resource: "x:*" }, except: { environment: "prod" }, decision: "ALLOW" }] }, true],
  [{ version: 1, default: "ALLOW", rules: [] }, false],
  [{ version: 2, default: "DENY", rules: [] }, false],
  [{ version: 1, default: "DENY" }, false],
  [{ version: 1, default: "DENY", rules: [], extra: 1 }, false],
  [{ version: 1, default: "DENY", rules: [rule({ when: {} })] }, false],
  [{ version: 1, default: "DENY", rules: [rule({ except: { verb: "Y" } })] }, false],
  [{ version: 1, default: "DENY", rules: [rule({ decision: "MAYBE" })] }, false],
  [{ version: 1, default: "DENY", rules: [rule({ when: { risk: "HUGE" } })] }, false],
  [{ version: 1, default: "DENY", rules: [rule({ when: { time: { hoursUtc: { from: 0, to: 24 } } } })] }, false],
  [{ version: 1, default: "DENY", resourceAllowlist: [], rules: [] }, false],
];
for (const [cfg, expected] of policyFixtures) {
  const schemaOk = policy(cfg);
  const runtimeOk = validatePolicyConfig(cfg).valid;
  check(`policy fixture schema=${schemaOk} runtime=${runtimeOk} expected=${expected}`, schemaOk === expected && runtimeOk === expected);
}

const { SAMPLE_CONFIG } = await import("../packages/cli/dist/templates.js");
check("senscheck init sample config passes schema and runtime validation", policy(SAMPLE_CONFIG) && validatePolicyConfig(SAMPLE_CONFIG).valid);

const e = createEffect({ principal: { id: "a", type: "agent" }, verb: "DELETE", resource: "file:/x", risk: "HIGH" });
check("effect schema accepts createEffect output", effectSchema(e) && canonicalizeEffect(e).ok);
const badEffect = { ...e, risk: "EXTREME" };
check("effect schema rejects unknown risk like runtime", !effectSchema(badEffect) && !canonicalizeEffect(badEffect).ok);
check("effect schema rejects unknown field like runtime", !effectSchema({ ...e, x: 1 }) && !canonicalizeEffect({ ...e, x: 1 }).ok);

const sink = new MemoryReceiptSink();
await new SensCheckGovernance({ policies: [], receiptSink: sink }).authorize(e);
check("receipt schema accepts engine receipt", receiptSchema(sink.receipts[0]) && verifyReceipt(sink.receipts[0]).valid);
check("receipt schema rejects bad decision", !receiptSchema({ ...sink.receipts[0], decision: "NO" }));

for (const f of readdirSync(new URL("../packages/core/schema/", import.meta.url))) check(`schema file parses: ${f}`, !!load(f.replace(".schema.json", "")));
process.exit(failures === 0 ? 0 : 1);
