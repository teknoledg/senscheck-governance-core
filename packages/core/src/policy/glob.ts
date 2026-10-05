/**
 * `*` matches any run of characters (including `:` and `/`), `?` matches one. Everything else is literal.
 * Iterative matcher with single-star backtracking: O(pattern * value) worst case, never exponential,
 * so an agent-influenced value cannot stall the event loop (a regex translation can).
 */
export function globMatch(pattern: string, value: string): boolean {
  let p = 0;
  let v = 0;
  let star = -1;
  let mark = 0;
  while (v < value.length) {
    const pc = pattern[p];
    if (pc === "*") {
      star = p++;
      mark = v;
    } else if (pc !== undefined && (pc === "?" || pc === value[v])) {
      p++;
      v++;
    } else if (star !== -1) {
      p = star + 1;
      v = ++mark;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

export function globMatchAny(patterns: string | readonly string[], value: string): boolean {
  const list = typeof patterns === "string" ? [patterns] : patterns;
  return list.some((p) => globMatch(p, value));
}
