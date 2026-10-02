// Structural validation of the plugin against the documented requirements of each platform.
// Checked against: Cursor plugins reference (name kebab-case; skills need name+description; rules need description;
// commands optional name/description) and OpenAI Agent Plugin packaging (portable plugin.json at root, extensions.com.openai,
// ./-relative paths, skills under skills/<name>/SKILL.md). It cannot replace the platforms' own submission review.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../plugin/", import.meta.url).pathname;
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`); if (!ok) failures++; };
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const frontmatter = (p) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(root, p), "utf8"));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
};
const NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

const portable = json("plugin.json");
check("portable plugin.json name kebab-case", NAME.test(portable.name));
check("portable plugin.json has version, description, author, license", !!(portable.version && portable.description && portable.author?.name && portable.license));
const oa = portable.extensions?.["com.openai"]?.interface;
check("openai interface has displayName/shortDescription/longDescription/developerName/category", !!(oa?.displayName && oa.shortDescription && oa.longDescription && oa.developerName && oa.category));
for (const key of ["logo"]) if (oa?.[key]) check(`openai ${key} path starts with ./ and exists`, oa[key].startsWith("./") && existsSync(join(root, oa[key])));
check("no skills field needed: skills/ at plugin root", existsSync(join(root, "skills")));

const cursor = json(".cursor-plugin/plugin.json");
check("cursor name kebab-case", NAME.test(cursor.name));
check("cursor has description/version/author", !!(cursor.description && cursor.version && cursor.author?.name));
check("cursor logo exists", !cursor.logo || existsSync(join(root, cursor.logo)));
for (const k of ["rules", "skills", "commands"]) check(`cursor ${k} path exists`, existsSync(join(root, cursor[k])));

const codex = json(".codex-plugin/plugin.json");
check("codex compat manifest name matches portable", codex.name === portable.name && codex.version === portable.version);
check("codex skills path exists", existsSync(join(root, codex.skills)));

for (const d of readdirSync(join(root, "skills"))) {
  const p = `skills/${d}/SKILL.md`;
  check(`${p} exists`, existsSync(join(root, p)));
  const fm = frontmatter(p);
  check(`${p} frontmatter name matches dir and has description`, !!fm && fm.name === d && !!fm.description);
}
for (const f of readdirSync(join(root, "rules"))) {
  const fm = frontmatter(`rules/${f}`);
  check(`rules/${f} has description frontmatter`, !!fm?.description);
}
for (const f of readdirSync(join(root, "commands"))) {
  const fm = frontmatter(`commands/${f}`);
  check(`commands/${f} has name+description`, !!(fm?.name && fm.description));
}
for (const f of ["fail-closed-governance", "governance-review", "secure-agent-tool"]) check(`required skill present: ${f}`, statSync(join(root, "skills", f)).isDirectory());
process.exit(failures === 0 ? 0 : 1);
