const cache = new Map<string, RegExp>();

/** `*` matches any run of characters (including `:` and `/`), `?` matches one. Everything else is literal. */
export function globMatch(pattern: string, value: string): boolean {
  let re = cache.get(pattern);
  if (re === undefined) {
    const source = pattern
      .split("")
      .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${source}$`, "s");
    cache.set(pattern, re);
  }
  return re.test(value);
}

export function globMatchAny(patterns: string | readonly string[], value: string): boolean {
  const list = typeof patterns === "string" ? [patterns] : patterns;
  return list.some((p) => globMatch(p, value));
}
