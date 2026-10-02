# @senscheck/governance-openai

Govern OpenAI-style function tools (`{ name, description?, parameters?, execute }`) with `@senscheck/governance-core`. Structural: it does not import the OpenAI SDK, only replaces `execute` and returns other fields untouched. Unclassified tools default to PRIVILEGED.

```ts
import { governFunctionTools } from "@senscheck/governance-openai";
const safeTools = governFunctionTools(tools, { governance, principal, classes: { search: "READ_ONLY", delete_user: "DESTRUCTIVE" } });
```

Note: READ_ONLY here still goes through governance (verb READ, LOW risk); policy must allow it.
