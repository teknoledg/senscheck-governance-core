# @senscheck/governance-cli

```bash
npx @senscheck/governance-cli init      # senscheck.config.json, example wrapper, .gitignore entry
npx @senscheck/governance-cli audit .   # heuristic list of consequential operations (not proof of safety)
npx @senscheck/governance-cli check     # validate policy config
npx @senscheck/governance-cli test      # fail-closed behavioural checks
npx @senscheck/governance-cli explain receipts.jsonl
```

Binary name: `senscheck`. Exit codes: 0 ok, 1 findings/failures, 2 usage or I/O error. Local only; no network.
