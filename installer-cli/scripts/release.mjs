#!/usr/bin/env node
/**
 * Release helper for the `weegloo` npm package (installer-cli/).
 *
 * This absorbs every DETERMINISTIC step of publishing so the accompanying skill
 * (weegloo-npm-publish) only has to handle the parts that genuinely need a human:
 *
 *   HUMAN GATE 1 — which version bump?  The script NEVER guesses. When a bump is
 *     required it stops and reports NEEDS_BUMP; the caller must pass `--bump`.
 *   HUMAN GATE 2 — actually publish?  Publishing to the public registry is
 *     irreversible. The script prints the exact plan and stops UNLESS `--yes` is
 *     given. No `--yes`, no publish.
 *
 * Everything else — config, npm auth (NPM_TOKEN + .npmrc), branch/dirty checks,
 * published-vs-current version comparison, tests, and the final report — is
 * mechanical and lives here, not in the skill.
 *
 * Commands:
 *   preflight   (default)  Run all checks, print a status block + a single verdict.
 *   release                preflight → apply --bump → test → (with --yes) publish.
 *
 * Options:
 *   --dist-tag <tag>   npm dist-tag / git branch. Default: package.json "pluginRef".
 *   --bump <level>     patch | minor | major | <explicit x.y.z>. Human gate 1.
 *   --yes              Actually publish. Human gate 2. Without it, release stops
 *                      at the publish step and only prints the plan.
 *   --no-tests         Skip `npm test`.
 *   --json             Emit machine-readable JSON instead of the text block.
 *
 * Exit codes:  0 = ok / stopped cleanly at a gate · 1 = BLOCKED or failure ·
 *              2 = NEEDS_BUMP but no --bump supplied (release only).
 *
 * This calls npm, NOT any Weegloo API — the "agents use MCP, deploy scripts must
 * not call Weegloo APIs" rule does not apply here.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');

// ── tiny ANSI helpers (no dependency, so the script runs even without node_modules) ──
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
const c = {
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  red: (s) => paint('31', s),
  cyan: (s) => paint('36', s),
  dim: (s) => paint('2', s),
  bold: (s) => paint('1', s),
};
const MARK = { ok: c.green('✔'), warn: c.yellow('⚠'), bad: c.red('✖'), info: c.cyan('→') };

/** Parse argv into { command, options }. */
function parseArgs(argv) {
  const positionals = [];
  const opts = { distTag: null, bump: null, yes: false, tests: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dist-tag': opts.distTag = argv[++i]; break;
      case '--bump': opts.bump = argv[++i]; break;
      case '--yes': case '-y': opts.yes = true; break;
      case '--no-tests': opts.tests = false; break;
      case '--json': opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--dist-tag=')) opts.distTag = a.slice(11);
        else if (a.startsWith('--bump=')) opts.bump = a.slice(7);
        else positionals.push(a);
    }
  }
  return { command: positionals[0] || 'preflight', opts };
}

/** Run a command, capturing output. Never throws; returns { code, stdout, stderr }. */
function run(cmd, args, { env = process.env, cwd = PACKAGE_ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  return {
    code: r.status ?? (r.error ? -1 : 0),
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    error: r.error,
  };
}

/**
 * Extract the NPM_TOKEN value from the text of a `.env` file. Pure — no I/O.
 * Handles an optional `export ` prefix, surrounding whitespace, and single/double
 * quotes. Anchored per-line so `MY_NPM_TOKEN=…` does NOT match. Returns the token
 * string, or null when absent or empty.
 * @param {string} text
 * @returns {string|null}
 */
export function parseNpmTokenFromEnv(text) {
  const m = String(text).match(/^\s*(?:export\s+)?NPM_TOKEN\s*=\s*(.+?)\s*$/m);
  if (!m) return null;
  let val = m[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val || null;
}

/** Read NPM_TOKEN from the environment, or from a gitignored .env (package dir, then repo root). */
function findNpmToken() {
  if (process.env.NPM_TOKEN) return { token: process.env.NPM_TOKEN, source: 'env' };
  for (const dir of [PACKAGE_ROOT, REPO_ROOT]) {
    const envPath = join(dir, '.env');
    if (!existsSync(envPath)) continue;
    const token = parseNpmTokenFromEnv(readFileSync(envPath, 'utf8'));
    if (token) return { token, source: `.env (${dir === PACKAGE_ROOT ? 'installer-cli' : 'repo root'})` };
  }
  return { token: null, source: null };
}

/** Collect every deterministic fact + a single verdict. Does not mutate anything. */
function preflight(opts) {
  const warnings = [];
  const blockers = [];

  // ── meta (package.json) ──
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const packageName = pkg.name;
  const current = pkg.version;
  const pluginRef = pkg.pluginRef || 'latest';
  const distTag = opts.distTag || pluginRef || 'latest';
  if (pluginRef !== distTag) {
    warnings.push(`package.json "pluginRef" (${pluginRef}) != dist-tag (${distTag}) — installer fetches skills/rules from the "${pluginRef}" branch.`);
  }

  // ── auth: NPM_TOKEN + .npmrc + npm whoami ──
  const { token, source: tokenSource } = findNpmToken();
  let whoami = null;
  if (!token) {
    blockers.push('NPM_TOKEN not found (env or .env). Create a Granular/Automation publish token and put NPM_TOKEN=... in .env.');
  } else {
    const env = { ...process.env, NPM_TOKEN: token };
    const who = run('npm', ['whoami'], { env });
    if (who.code === 0 && who.stdout) whoami = who.stdout;
    else blockers.push(`npm whoami failed (token wrong/expired?): ${who.stderr || who.stdout || 'no output'}`);
  }
  const npmrcPath = join(PACKAGE_ROOT, '.npmrc');
  const npmrcOk = existsSync(npmrcPath) && readFileSync(npmrcPath, 'utf8').includes('${NPM_TOKEN}');
  if (!npmrcOk) warnings.push('installer-cli/.npmrc is missing or does not reference ${NPM_TOKEN}.');
  const gitignore = existsSync(join(PACKAGE_ROOT, '.gitignore')) ? readFileSync(join(PACKAGE_ROOT, '.gitignore'), 'utf8') : '';
  if (!/(^|\n)\.npmrc(\s|$)/.test(gitignore) || !/(^|\n)\.env(\s|$)/.test(gitignore)) {
    warnings.push('.gitignore should ignore both .npmrc and .env (secrets must never be committed).');
  }

  // ── repo: branch vs dist-tag, dirty tree ──
  const branch = run('git', ['branch', '--show-current'], { cwd: REPO_ROOT }).stdout;
  if (branch && branch !== distTag) {
    warnings.push(`git branch "${branch}" != dist-tag "${distTag}" — the installer serves skills/rules from the branch matching the tag.`);
  }
  const dirty = run('git', ['status', '--porcelain'], { cwd: REPO_ROOT }).stdout;
  if (dirty) warnings.push(`working tree is dirty (${dirty.split('\n').length} changed path(s)). Commit/push is your job, done separately.`);

  // ── version: published vs current (3-way) ──
  let published = null;
  if (token || process.env.NPM_TOKEN) {
    const view = run('npm', ['view', packageName, 'version'], { env: token ? { ...process.env, NPM_TOKEN: token } : process.env });
    if (view.code === 0 && view.stdout) published = view.stdout;
    else if (/E404|is not in this registry|404/.test(view.stderr)) published = null; // never published
    else if (view.stderr) warnings.push(`could not read published version: ${view.stderr.split('\n')[0]}`);
  }

  const versionState = classifyVersion(current, published);
  if (versionState === 'behind') {
    blockers.push(`registry is AHEAD: published ${published} > current ${current}. Refusing to overwrite — bump past ${published} first.`);
  }

  const verdict = decideVerdict({ versionState, blockers });

  // The resolved number each bump level would produce — so the caller can show a
  // single "publish as patch → x.y.z?" prompt (bump choice == publish approval).
  const nextVersions = {
    patch: bumpVersion(current, 'patch'),
    minor: bumpVersion(current, 'minor'),
    major: bumpVersion(current, 'major'),
  };

  return {
    packageName, current, published, distTag, pluginRef, branch,
    tokenSource, whoami, npmrcOk, dirty: Boolean(dirty),
    versionState, nextVersions, warnings, blockers, verdict,
  };
}

/** Compare two semver-ish x.y.z strings (numeric core only). >0 if a>b, 0 if equal, <0 if a<b. */
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Classify the current package version against what the registry already has.
 * `published === null` means the package has never been published.
 * @returns {'first'|'ahead'|'equal'|'behind'}
 */
export function classifyVersion(current, published) {
  if (published === null || published === undefined) return 'first';
  const d = cmpVersion(current, published);
  if (d > 0) return 'ahead';
  if (d === 0) return 'equal';
  return 'behind';
}

/**
 * The single release verdict, derived purely from the version state and any blockers.
 * BLOCKED wins over everything; 'equal' means a bump is required; 'first'/'ahead' are READY.
 * @returns {'BLOCKED'|'NEEDS_BUMP'|'READY'}
 */
export function decideVerdict({ versionState, blockers = [] }) {
  if (blockers.length) return 'BLOCKED';
  if (versionState === 'equal') return 'NEEDS_BUMP';
  return 'READY';
}

/**
 * The version that a given bump level would produce from `current`. Pure.
 * @param {string} current  x.y.z
 * @param {'patch'|'minor'|'major'} level
 * @returns {string|null}  null for an unknown level
 */
export function bumpVersion(current, level) {
  const [maj = 0, min = 0, pat = 0] = String(current).split('.').map((n) => parseInt(n, 10) || 0);
  switch (level) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${pat + 1}`;
    default: return null;
  }
}

/** Human-readable status block. */
function printStatus(s) {
  const line = (mark, label, msg) => console.log(`${mark} ${c.bold(label.padEnd(9))} ${msg}`);
  console.log(c.bold(`\nweegloo release preflight  ${c.dim(`(${PACKAGE_ROOT})`)}\n`));
  line(MARK.info, 'config', `package=${s.packageName}  dist-tag=${s.distTag}  pluginRef=${s.pluginRef}`);
  line(s.whoami ? MARK.ok : MARK.bad, 'auth', s.whoami ? `whoami=${s.whoami}  (token via ${s.tokenSource})` : 'no working npm token');
  line(s.branch === s.distTag ? MARK.ok : MARK.warn, 'repo', `branch=${s.branch || '?'}${s.branch === s.distTag ? '' : `  (expected ${s.distTag})`}`);
  line(s.dirty ? MARK.warn : MARK.ok, 'git', s.dirty ? 'working tree dirty' : 'clean');
  const vmsg = {
    first: `published=(none, first publish)  current=${s.current}`,
    ahead: `published=${s.published}  current=${s.current}  → OK to publish`,
    equal: `published=${s.published}  current=${s.current}  → BUMP REQUIRED`,
    behind: `published=${s.published}  current=${s.current}  → registry ahead`,
  }[s.versionState];
  line(s.versionState === 'behind' ? MARK.bad : s.versionState === 'equal' ? MARK.warn : MARK.ok, 'version', vmsg);
  if (s.verdict === 'NEEDS_BUMP') {
    line(MARK.info, 'bump', `patch → ${s.nextVersions.patch}   minor → ${s.nextVersions.minor}   major → ${s.nextVersions.major}`);
  }

  for (const w of s.warnings) console.log(`  ${c.yellow('warn')}  ${w}`);
  for (const b of s.blockers) console.log(`  ${c.red('block')} ${b}`);

  const vColor = s.verdict === 'BLOCKED' ? c.red : s.verdict === 'NEEDS_BUMP' ? c.yellow : c.green;
  console.log(`\nverdict: ${vColor(c.bold(s.verdict))}` +
    (s.blockers.length ? c.dim(`  (${s.blockers.length} blocker(s))`) : s.warnings.length ? c.dim(`  (${s.warnings.length} warning(s))`) : '') + '\n');
}

function emit(s, opts) {
  if (opts.json) console.log(JSON.stringify(s, null, 2));
  else printStatus(s);
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 45).join('\n').replace(/^ \* ?/gm, '').replace(/^\/\*\*?/, ''));
    return;
  }

  const s = preflight(opts);

  if (command === 'preflight') {
    emit(s, opts);
    process.exit(s.verdict === 'BLOCKED' ? 1 : 0);
  }

  if (command !== 'release') {
    console.error(c.red(`Unknown command "${command}". Use "preflight" or "release".`));
    process.exit(1);
  }

  // ── release ──
  emit(s, opts);
  if (s.verdict === 'BLOCKED') {
    console.error(c.red('BLOCKED — resolve the blocker(s) above before releasing.'));
    process.exit(1);
  }

  // HUMAN GATE 1: bump. The script never chooses the level.
  let versionToPublish = s.current;
  if (opts.bump) {
    // `npm version` accepts both keywords (patch/minor/major) and explicit x.y.z here.
    const bumped = run('npm', ['--no-git-tag-version', 'version', opts.bump]);
    if (bumped.code !== 0) {
      console.error(c.red(`bump failed: ${bumped.stderr || bumped.stdout}`));
      process.exit(1);
    }
    versionToPublish = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
    console.log(`${MARK.ok} bumped   package.json → ${c.bold(versionToPublish)} ${c.dim('(uncommitted — commit/push is yours)')}`);
  } else if (s.verdict === 'NEEDS_BUMP') {
    console.error(c.yellow('\nNEEDS_BUMP: published == current. Re-run with --bump patch|minor|major|<x.y.z>.'));
    process.exit(2); // human gate not satisfied
  }

  // tests
  if (opts.tests) {
    console.log(`${MARK.info} test     running \`npm test\`…`);
    const t = spawnSync('npm', ['test'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    if (t.status !== 0) {
      console.error(c.red('tests failed — aborting before publish.'));
      process.exit(1);
    }
    console.log(`${MARK.ok} test     passed`);
  } else {
    console.log(`${MARK.warn} test     skipped (--no-tests)`);
  }

  // HUMAN GATE 2: publish. No --yes → print the plan and stop.
  const publishArgs = ['publish', '--access', 'public', '--tag', s.distTag];
  if (!opts.yes) {
    console.log(`\n${c.bold('PLAN')} — nothing published yet.`);
    console.log(`  version : ${versionToPublish}`);
    console.log(`  dist-tag: ${s.distTag}`);
    console.log(`  command : ${c.cyan(`npm ${publishArgs.join(' ')}`)}  ${c.dim('(cwd: installer-cli)')}`);
    console.log(`\nConfirm, then re-run with ${c.bold('--yes')} to publish.`);
    process.exit(0);
  }

  const { token } = findNpmToken();
  const env = token ? { ...process.env, NPM_TOKEN: token } : process.env;
  console.log(`\n${MARK.info} publish  npm ${publishArgs.join(' ')}`);
  const pub = spawnSync('npm', publishArgs, { cwd: PACKAGE_ROOT, env, stdio: 'inherit' });
  if (pub.status !== 0) {
    console.error(c.red('\npublish failed. If it demanded an OTP, the token type is wrong — use a Granular/Automation token.'));
    process.exit(1);
  }
  console.log(`\n${MARK.ok} ${c.bold('published')} ${s.packageName}@${versionToPublish}  (tag ${s.distTag})`);
  console.log(`  https://www.npmjs.com/package/${s.packageName}`);
  if (opts.bump) console.log(c.dim('  reminder: package.json has an uncommitted version bump — commit & push it.'));
}

// Run only when invoked directly (`node scripts/release.mjs …`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
