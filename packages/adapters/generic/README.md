# @senscheck/generic-tools

Explicit governed wrappers (no monkey-patching) for filesystem mutations (`governFs`), process runners (`governProcess`), fetch (`governFetch`: GET/HEAD/OPTIONS pass through) and SQL (`governSql`: single plain SELECT passes through; everything else governed). Built on `@senscheck/governance-core`. Paths are resolved, content and bodies are bound by sha256, unsupported inputs fail closed. The SQL classifier is not a parser: use database permissions as the real boundary.
