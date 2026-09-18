#!/usr/bin/env node
/**
 * Behavioral fixture runner — the regression net for the skill/rule restructure.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every byte-counting CI check is satisfied identically by "we deleted a duplicate"
 * and by "we deleted a gate". Bytes cannot tell those apart. This runner can: it puts
 * a real prompt in front of a real agent and asserts on what the agent DECIDES.
 *
 * The restructure's one hard requirement is "the agent must not get worse". That is a
 * claim about behavior, so it has to be measured as behavior. Record a baseline BEFORE
 * deleting anything, then re-run on every PR and refuse a merge that loses ground.
 *
 * SAFETY
 * ------
 * Fixtures are PLAN-ONLY. Each prompt is wrapped with an instruction to describe the
 * plan and NOT call MCP tools or create resources, so a run never touches a real Space.
 * What we score is the routing/knowledge the restructure puts at risk, which is exactly
 * the part that lives in skills and rules.
 *
 * USAGE
 *   node tests/run-fixtures.mjs --out tests/baseline.develop.json
 *   node tests/run-fixtures.mjs --out tests/run.json --compare tests/baseline.develop.json
 *   node tests/run-fixtures.mjs --only members-only-site --verbose
 *
 * EXIT CODES
 *   0  all fixtures met their asserts, or (with --compare) nothing regressed
 *   1  a regression vs the baseline, or a failure with no baseline to compare against
 *   2  harness error (bad fixture, agent command missing, etc.)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'routing');

/** Appended to every fixture prompt so a run never mutates a real Weegloo Space. */
const PLAN_ONLY_SUFFIX = `

---
(이 요청은 자동화된 회귀 테스트입니다. 실제로 리소스를 만들거나 수정하지 말고, MCP 도구도 호출하지 마세요.
어떤 Weegloo 기능·API·역할·필드를 어떻게 쓸 것인지 **계획과 근거만** 구체적으로 적어주세요.
Organization/Space 선택이나 추가 정보를 사용자에게 되묻지 말고, 필요하면 가정을 명시하고 계획을 끝까지 작성하세요.)`;

function parseArgs(argv) {
  const out = { only: null, out: null, compare: null, verbose: false, concurrency: 4, agentCmd: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') out.only = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--agent-cmd') out.agentCmd = argv[++i];
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** Loads every fixture module, validating the shape the runner depends on. */
async function loadFixtures(only) {
  if (!existsSync(FIXTURE_DIR)) throw new Error(`fixture dir missing: ${FIXTURE_DIR}`);
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const fixtures = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(FIXTURE_DIR, file)).href);
    const fx = mod.default;
    if (!fx || typeof fx !== 'object') throw new Error(`${file}: no default export`);
    for (const key of ['id', 'lang', 'prompt', 'asserts']) {
      if (!fx[key]) throw new Error(`${file}: missing '${key}'`);
    }
    if (!Array.isArray(fx.asserts) || fx.asserts.length === 0) throw new Error(`${file}: 'asserts' must be a non-empty array`);
    for (const a of fx.asserts) {
      if (!a.id || !a.kind || !a.pattern || !a.why) throw new Error(`${file}: assert needs id/kind/pattern/why`);
      if (!['must_match', 'must_not_match'].includes(a.kind)) throw new Error(`${file}: bad assert kind '${a.kind}'`);
      if (!(a.pattern instanceof RegExp)) throw new Error(`${file}: assert '${a.id}' pattern must be a RegExp literal`);
    }
    fx.__file = file;
    if (!only || fx.id === only) fixtures.push(fx);
  }
  if (only && fixtures.length === 0) throw new Error(`--only '${only}' matched no fixture`);
  return fixtures;
}

/**
 * Provenance for the scorecard. A score is meaningless without knowing WHICH corpus
 * produced it — the whole point of the baseline is a before/after on the same ref.
 */
function corpusProvenance() {
  const sh = (cmd) => { try { return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim(); } catch { return null; } };
  const bytes = (dir, filter) => {
    const d = path.join(REPO_ROOT, dir);
    if (!existsSync(d)) return 0;
    let total = 0;
    const walk = (p) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (!filter || filter(e.name)) total += readFileSync(full).length;
      }
    };
    walk(d);
    return total;
  };
  return {
    gitRef: sh('git rev-parse --abbrev-ref HEAD'),
    gitSha: sh('git rev-parse --short HEAD'),
    gitDirty: sh('git status --porcelain') ? true : false,
    ruleBytes: bytes('plugins/weegloo/rules', (n) => n.endsWith('.mdc')),
    skillBytes: bytes('plugins/weegloo/skills', (n) => n.endsWith('.md')),
  };
}

/** Runs one prompt through the agent CLI and returns its stdout. */
function runAgent(agentCmd, prompt, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const [cmd, ...baseArgs] = agentCmd;
    const child = spawn(cmd, [...baseArgs, prompt], {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      env: { ...process.env },
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`agent timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) reject(new Error(`agent exited ${code}: ${stderr.slice(0, 500)}`));
      else resolve(stdout);
    });
  });
}

function evaluate(fixture, response) {
  const results = fixture.asserts.map((a) => {
    const hit = a.pattern.test(response);
    const pass = a.kind === 'must_match' ? hit : !hit;
    return { id: a.id, kind: a.kind, pattern: String(a.pattern), why: a.why, pass };
  });
  return { id: fixture.id, lang: fixture.lang, file: fixture.__file, asserts: results, passed: results.filter((r) => r.pass).length, total: results.length };
}

/** Bounded-concurrency map — keeps the agent fleet small enough to stay responsive. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 32).join('\n')); return 0; }

  const fixtures = await loadFixtures(args.only);
  const provenance = corpusProvenance();

  if (args.dryRun) {
    console.log(`${fixtures.length} fixtures, ${fixtures.reduce((s, f) => s + f.asserts.length, 0)} asserts`);
    for (const f of fixtures) console.log(`  [${f.lang}] ${f.id}  (${f.asserts.length} asserts)  ${f.__file}`);
    console.log(`\ncorpus: ${provenance.gitRef}@${provenance.gitSha}${provenance.gitDirty ? ' (dirty)' : ''}  rules=${provenance.ruleBytes}B skills=${provenance.skillBytes}B`);
    return 0;
  }

  const agentCmd = (args.agentCmd || process.env.WEEGLOO_FIXTURE_AGENT_CMD || 'claude -p').split(' ').filter(Boolean);
  console.log(`agent: ${agentCmd.join(' ')}`);
  console.log(`corpus: ${provenance.gitRef}@${provenance.gitSha}${provenance.gitDirty ? ' (dirty)' : ''}`);
  console.log(`running ${fixtures.length} fixtures (concurrency ${args.concurrency})...\n`);

  const results = await mapLimit(fixtures, args.concurrency, async (fx) => {
    try {
      const response = await runAgent(agentCmd, fx.prompt + PLAN_ONLY_SUFFIX);
      const r = evaluate(fx, response);
      if (args.verbose) r.response = response;
      const mark = r.passed === r.total ? 'PASS' : 'FAIL';
      console.log(`  ${mark}  ${fx.id}  ${r.passed}/${r.total}`);
      for (const a of r.asserts.filter((x) => !x.pass)) console.log(`        ✗ ${a.id} — ${a.why}`);
      return r;
    } catch (err) {
      console.log(`  ERROR ${fx.id}: ${err.message}`);
      return { id: fx.id, lang: fx.lang, file: fx.__file, error: err.message, asserts: [], passed: 0, total: fx.asserts.length };
    }
  });

  const totalAsserts = results.reduce((s, r) => s + r.total, 0);
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const scorecard = { provenance, agentCmd: agentCmd.join(' '), totals: { fixtures: results.length, asserts: totalAsserts, passed: totalPassed }, results };

  console.log(`\n${totalPassed}/${totalAsserts} asserts passed across ${results.length} fixtures`);

  if (args.out) {
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    writeFileSync(args.out, JSON.stringify(scorecard, null, 2), 'utf-8');
    console.log(`scorecard → ${args.out}`);
  }

  if (args.compare) {
    if (!existsSync(args.compare)) { console.error(`baseline not found: ${args.compare}`); return 2; }
    const base = JSON.parse(readFileSync(args.compare, 'utf-8'));
    const baseByAssert = new Map();
    for (const r of base.results) for (const a of r.asserts) baseByAssert.set(`${r.id}::${a.id}`, a.pass);

    const regressions = [];
    for (const r of results) {
      for (const a of r.asserts) {
        const key = `${r.id}::${a.id}`;
        if (baseByAssert.get(key) === true && a.pass === false) regressions.push({ key, why: a.why });
      }
    }
    console.log(`\nbaseline: ${base.provenance.gitRef}@${base.provenance.gitSha} — ${base.totals.passed}/${base.totals.asserts}`);
    if (regressions.length) {
      console.error(`\nREGRESSION — ${regressions.length} assert(s) that passed on the baseline now fail:`);
      for (const r of regressions) console.error(`  ✗ ${r.key}\n      ${r.why}`);
      return 1;
    }
    console.log('no regressions.');
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err.stack || err.message); process.exit(2); });
