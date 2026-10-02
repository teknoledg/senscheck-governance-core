// Builds the static site in ./site from PRIVACY.md, TERMS.md and the JSON Schemas. No dependencies.
// Usage: node scripts/build-site.mjs [--check]   (--check fails if site/ is out of date)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const site = join(root, "site");
const check = process.argv.includes("--check");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
      const map = { "LICENSE": "https://github.com/teknoledg/senscheck-governance-core/blob/main/LICENSE", "NOTICE": "https://github.com/teknoledg/senscheck-governance-core/blob/main/NOTICE" };
      const href = map[u] ?? (/^https?:/.test(u) ? u : `https://github.com/teknoledg/senscheck-governance-core/blob/main/${u}`);
      return `<a href="${href}">${t}</a>`;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function md(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  let title = "";
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === "") { i++; continue; }
    let m;
    if ((m = /^(#{1,3}) (.*)/.exec(l))) {
      const n = m[1].length;
      if (n === 1 && !title) title = m[2];
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      i++;
    } else if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (/^- /.test(l)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3} |\||- )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return { html: out.join("\n"), title };
}

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#14202b;--muted:#5b6b7a;--accent:#0b3d5c;--line:#d8e0e7;--code:#eef3f7}
@media (prefers-color-scheme:dark){:root{--bg:#0e1419;--fg:#e6edf3;--muted:#9aa9b7;--accent:#7cc0e8;--line:#27323c;--code:#18222b}}
:root[data-theme=light]{--bg:#fff;--fg:#14202b;--muted:#5b6b7a;--accent:#0b3d5c;--line:#d8e0e7;--code:#eef3f7}
:root[data-theme=dark]{--bg:#0e1419;--fg:#e6edf3;--muted:#9aa9b7;--accent:#7cc0e8;--line:#27323c;--code:#18222b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
header,main,footer{max-width:46rem;margin:0 auto;padding:0 16px}header{padding-top:24px;padding-bottom:12px;border-bottom:1px solid var(--line)}
header a{color:var(--fg);font-weight:600;text-decoration:none}header span{color:var(--muted);margin-left:8px}
nav{margin-top:6px;font-size:.9rem}nav a{color:var(--accent);margin-right:14px;font-weight:400}
main{padding-top:20px;padding-bottom:40px}h1{font-size:1.8rem;line-height:1.25}h2{font-size:1.25rem;margin-top:2rem}a{color:var(--accent)}
code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.9em}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--code)}
footer{padding-top:16px;padding-bottom:32px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}li{margin:.25rem 0}`;

const page = (title, body, desc) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · SensCheck Governance — Core</title>
<meta name="description" content="${esc(desc)}">
<style>${CSS}</style>
</head>
<body>
<header><a href="/">SensCheck Governance — Core</a><span>Agents fail. Fail closed.</span>
<nav><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/schema/">Schemas</a><a href="https://github.com/teknoledg/senscheck-governance-core">GitHub</a></nav></header>
<main>
${body}
</main>
<footer>© TEKNOLED-G LIMITED. Software licensed under Apache-2.0.</footer>
</body>
</html>
`;

const pages = new Map();
for (const [file, dir, desc] of [
  ["PRIVACY.md", "privacy", "Privacy policy for SensCheck Governance — Core: the software collects no data."],
  ["TERMS.md", "terms", "Terms of use for SensCheck Governance — Core."],
]) {
  const { html, title } = md(readFileSync(join(root, file), "utf8"));
  pages.set(`${dir}/index.html`, page(title.replace(/\*\*/g, ""), html, desc));
}

const schemaDir = join(root, "packages/core/schema");
const schemas = readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"));
const schemaList = schemas.map((f) => `<li><a href="/schema/${f}"><code>${f}</code></a></li>`).join("\n");
pages.set(
  "schema/index.html",
  page("JSON Schemas", `<h1>JSON Schemas</h1>\n<p>Stable identifiers for the SensCheck Governance — Core policy, effect and receipt formats. Each schema's <code>$id</code> is its URL here.</p>\n<ul>\n${schemaList}\n</ul>`, "JSON Schemas for SensCheck Governance — Core."),
);
pages.set(
  "index.html",
  page(
    "Home",
    `<h1>SensCheck Governance — Core</h1>
<p><strong>Agents fail. Fail closed.</strong> Deterministic governance boundaries for AI agents. Open source (Apache-2.0), offline, no account, no telemetry.</p>
<ul>
<li><a href="https://github.com/teknoledg/senscheck-governance-core">Source and documentation</a></li>
<li><a href="/schema/">JSON Schemas</a></li>
<li><a href="/privacy/">Privacy policy</a></li>
<li><a href="/terms/">Terms of use</a></li>
</ul>`,
    "SensCheck Governance — Core: fail-closed governance for AI agents.",
  ),
);

let stale = [];
for (const [rel, html] of pages) {
  const target = join(site, rel);
  if (check) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== html) stale.push(rel);
  } else {
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, html);
  }
}
mkdirSync(join(site, "schema"), { recursive: true });
for (const f of schemas) {
  const src = readFileSync(join(schemaDir, f), "utf8");
  const dst = join(site, "schema", f);
  if (check) {
    if (!existsSync(dst) || readFileSync(dst, "utf8") !== src) stale.push(`schema/${f}`);
  } else {
    cpSync(join(schemaDir, f), dst);
  }
}
if (check) {
  if (stale.length) { console.error(`site/ is out of date: ${stale.join(", ")}. Run: node scripts/build-site.mjs`); process.exit(1); }
  console.log(`site/ is up to date (${pages.size} pages, ${schemas.length} schemas)`);
} else {
  console.log(`built site/: ${pages.size} pages, ${schemas.length} schemas`);
}
