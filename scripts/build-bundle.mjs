/**
 * Builds the distributable plugin bundle that the installer CLI downloads as a
 * single GitHub Release asset — replacing per-directory GitHub Contents API
 * calls (rate-limited) and per-file raw fetches.
 *
 * Output (under dist/bundle/):
 *   manifest.json          — lists every skill/rule so the CLI can populate its
 *                            picker WITHOUT calling api.github.com/contents
 *   skills/<id>/...        — each skill's files (SKILL.md, metadata.json, ...)
 *   rules/<id>.mdc         — each rule source
 *   .mcp.json              — MCP server config for this ref
 *
 * The CI release workflow zips dist/bundle into weegloo-bundle.zip and uploads
 * both that zip and manifest.json as release assets. Downloading them via
 *   https://github.com/<repo>/releases/latest/download/<asset>
 * needs neither a git client nor the GitHub REST API, so it is immune to both
 * the git-not-installed and the 60-req/hour-unauthenticated constraints.
 *
 * Usage:  BUNDLE_REF=v1.0.13 node scripts/build-bundle.mjs
 *         node scripts/build-bundle.mjs v1.0.13
 */
import {
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SRC = path.join(REPO_ROOT, 'plugins', 'weegloo');
const OUT = path.join(REPO_ROOT, 'dist', 'bundle');

const ref = process.env.BUNDLE_REF || process.argv[2] || 'dev';

/** Recursively copies a directory tree (files only, dirs created as needed). */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) copyFileSync(src, dest);
  }
}

function listFiles(dir) {
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function fail(msg) {
  console.error(`✗ build-bundle: ${msg}`);
  process.exit(1);
}

// ── Read source ──────────────────────────────────────────────
const skillsSrc = path.join(SRC, 'skills');
const rulesSrc = path.join(SRC, 'rules');
const mcpSrc = path.join(SRC, '.mcp.json');

if (!existsSync(skillsSrc)) fail(`missing ${skillsSrc}`);
if (!existsSync(rulesSrc)) fail(`missing ${rulesSrc}`);

const skills = readdirSync(skillsSrc, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b))
  .map((id) => ({ id, files: listFiles(path.join(skillsSrc, id)) }));

const rules = readdirSync(rulesSrc)
  .filter((name) => name.endsWith('.mdc'))
  .sort((a, b) => a.localeCompare(b))
  .map((file) => ({ id: file.replace(/\.mdc$/, ''), file }));

if (skills.length === 0) fail('no skills found — refusing to publish an empty bundle');
if (rules.length === 0) fail('no rules found — refusing to publish an empty bundle');
for (const s of skills) {
  if (!s.files.includes('SKILL.md')) fail(`skill "${s.id}" has no SKILL.md`);
}

// ── Stage output ─────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyDir(skillsSrc, path.join(OUT, 'skills'));
copyDir(rulesSrc, path.join(OUT, 'rules'));
if (existsSync(mcpSrc)) copyFileSync(mcpSrc, path.join(OUT, '.mcp.json'));

const manifest = {
  schemaVersion: 1,
  ref,
  repoContentPrefix: 'plugins/weegloo',
  skills,
  rules,
};
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(
  `✓ bundle built for ref "${ref}": ${skills.length} skills, ${rules.length} rules → ${path.relative(REPO_ROOT, OUT)}`
);
