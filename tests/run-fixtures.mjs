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
import { buildJudgePrompt, parseVerdict } from './judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'routing');

/**
 * Below this, a reply cannot be a real answer to any fixture — it is a refusal, a crash or
 * a mangled prompt. Such a run is reported as an ERROR, never scored.
 */
const MIN_RESPONSE_CHARS = 200;

/**
 * Appended to every fixture prompt so a run never mutates a real Weegloo Space.
 *
 * The no-questions clause exists so a fixture gets a full plan to score instead of a one-line
 * question back. It carries an EXCEPTION for irreversible actions, and that exception is not a
 * convenience — without it this wrapper contradicts the rule it is trying to measure.
 * `weegloo-resource-deletion` requires the agent to "confirm before deleting anything the user
 * did not name"; a blanket "do not ask the user anything" makes the correct behavior
 * unreachable, and the fixture then scores the model for obeying the harness. Measured: the
 * space-teardown confirm assert flipped 2 of 5 runs on an UNCHANGED corpus, and reading the
 * responses showed the model confirming in three separate places and still being graded NO.
 * An instrument that punishes the behavior it is testing for cannot detect a regression in it.
 */
const PLAN_ONLY_SUFFIX = `

---
(이 요청은 자동화된 회귀 테스트입니다. 실제로 리소스를 만들거나 수정하지 말고, MCP 도구도 호출하지 마세요.
어떤 Weegloo 기능·API·역할·필드를 어떻게 쓸 것인지 **계획과 근거만** 구체적으로 적어주세요.
Organization/Space 선택이나 추가 정보를 사용자에게 되묻지 말고, 필요하면 가정을 명시하고 계획을 끝까지 작성하세요.
단, 삭제·파기처럼 **되돌릴 수 없는 동작에 대한 확인**은 이 제한의 예외입니다 — 그건 물어도 되고, 물어야 합니다.
그 경우에도 계획 자체는 생략하지 말고 끝까지 작성하세요.)`;

function parseArgs(argv) {
  const out = { only: null, out: null, compare: null, merge: null, verbose: false, concurrency: 4, agentCmd: null, dryRun: false, confirmRetries: 4 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') out.only = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--merge') out.merge = argv[++i];
    else if (a === '--confirm-retries') out.confirmRetries = Number(argv[++i]);
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
      if (!a.id || !a.kind || !a.why) throw new Error(`${file}: assert needs id/kind/why`);
      if (!['must_match', 'must_not_match', 'judge'].includes(a.kind)) throw new Error(`${file}: bad assert kind '${a.kind}'`);
      if (a.kind === 'judge') {
        if (!a.question || !['yes', 'no'].includes(a.expect)) {
          throw new Error(`${file}: judge assert '${a.id}' needs 'question' and expect: 'yes'|'no'`);
        }
      } else if (!(a.pattern instanceof RegExp)) {
        throw new Error(`${file}: assert '${a.id}' pattern must be a RegExp literal`);
      }
    }
    fx.__file = file;
    // `--only` takes a comma-separated list so a partial re-run (e.g. the fixtures a rate
    // limit cut short) can be merged back into an existing scorecard with --merge.
    const wanted = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (!wanted || wanted.includes(fx.id)) fixtures.push(fx);
  }
  if (only) {
    const wanted = only.split(',').map((s) => s.trim()).filter(Boolean);
    const missing = wanted.filter((w) => !fixtures.some((f) => f.id === w));
    if (missing.length) throw new Error(`--only matched no fixture: ${missing.join(', ')}`);
  }
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
  // The git fields describe the REPO. They are not what the agent read — the agent reads the
  // INSTALLED corpus under the user's agent home, which only changes when the installer runs.
  // Recording only the repo sha made a scorecard look precise while saying nothing about the
  // corpus actually measured, so the installer's own stamp is recorded alongside it. When the
  // two disagree (repo edited, not yet installed) that is expected, not an error — but it has
  // to be visible, because a comparison is only meaningful between two runs of the same
  // INSTALLED corpus.
  let installed = null;
  try {
    const stamp = path.join(process.env.USERPROFILE || process.env.HOME || '', '.weegloo', 'claude', 'version-check.json');
    if (existsSync(stamp)) {
      const s = JSON.parse(readFileSync(stamp, 'utf-8'));
      installed = { ref: s.ref ?? null, version: s.version ?? null };
    }
  } catch { /* the stamp is a convenience, never a requirement */ }

  // WHICH ACCOUNT ANSWERED. The corpus is not the only thing that can differ between two
  // scorecards: `claude -p` resolves its model and its rate limits from the organization its
  // OAuth login is bound to, and that binding lives outside this repo. A run taken under a
  // different org is a different INSTRUMENT, so a per-assert comparison across the two is only
  // as trustworthy as that difference is small — which cannot be judged if it is not recorded.
  // (Observed: the CLI kept a profile cached from hours earlier and kept answering as the old
  // org long after the account had been switched.) Name only — no uuid, no email.
  let agentOrg = null;
  try {
    const cfg = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude.json');
    if (existsSync(cfg)) agentOrg = JSON.parse(readFileSync(cfg, 'utf-8'))?.oauthAccount?.organizationName ?? null;
  } catch { /* provenance, never a requirement */ }

  return {
    gitRef: sh('git rev-parse --abbrev-ref HEAD'),
    gitSha: sh('git rev-parse --short HEAD'),
    gitDirty: sh('git status --porcelain') ? true : false,
    installedRef: installed?.ref ?? null,
    agentOrg,
    agentModel: process.env.ANTHROPIC_MODEL ?? null,
    installedVersion: installed?.version ?? null,
    ruleBytes: bytes('plugins/weegloo/rules', (n) => n.endsWith('.mdc')),
    skillBytes: bytes('plugins/weegloo/skills', (n) => n.endsWith('.md')),
  };
}

/**
 * Runs one prompt through the agent CLI and returns its stdout.
 *
 * The prompt goes in on STDIN, never as an argv element. Windows needs `shell: true` to
 * resolve the `claude` .cmd shim, and a shell re-parses the command line — a multi-line
 * prompt full of quotes and backticks arrives mangled (observed: the whole prompt collapsed
 * to the single character "I", and the agent dutifully answered that). Keeping user text
 * off the command line removes the failure mode entirely rather than escaping around it.
 */
function runAgent(agentCmd, prompt, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const [cmd, ...baseArgs] = agentCmd;
    const child = spawn(cmd, baseArgs, {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {}); // a fast-exiting agent closes stdin before we finish writing
    child.stdin.end(prompt, 'utf-8');
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

/**
 * Asks a second agent whether the response satisfies a rubric question. Answers YES/NO only.
 *
 * Regex cannot express "did the agent RECOMMEND this", only "does this string occur", and the
 * two come apart in exactly the case that matters. Measured on the first baseline: an assert
 * forbidding `/Administrator.*(바인딩|사용)/` failed on the sentence
 * "Administrator 바인딩은 어떤 경우에도 하지 않습니다" — the agent doing precisely the right
 * thing, scored as a violation. 9 of 61 asserts failed that way. An instrument with a ~15%
 * false-positive rate cannot support the claim this whole project rests on ("the agent did not
 * get worse"), so prose judgements are judged and only structural facts stay regex.
 */
async function runJudge(agentCmd, response, question) {
  const raw = (await runAgent(agentCmd, buildJudgePrompt(response, question), 300_000)).trim();
  const verdict = parseVerdict(raw);
  // No parseable verdict is a MISSING measurement, not a NO. Reading it as NO would invent a
  // failing assert out of a judge that rambled, which is the same false-signal bug as scoring a
  // truncated response — the caller turns this into an errored fixture instead.
  if (verdict === null) throw new Error(`judge returned no verdict: ${JSON.stringify(raw.slice(0, 160))}`);
  return verdict;
}

async function evaluate(fixture, response, agentCmd) {
  const results = [];
  for (const a of fixture.asserts) {
    if (a.kind === 'judge') {
      const verdict = await runJudge(agentCmd, response, a.question);
      results.push({ id: a.id, kind: a.kind, question: a.question, expect: a.expect, why: a.why, pass: verdict === (a.expect === 'yes') });
    } else {
      const hit = a.pattern.test(response);
      results.push({ id: a.id, kind: a.kind, pattern: String(a.pattern), why: a.why, pass: a.kind === 'must_match' ? hit : !hit });
    }
  }
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
      // A truncated or refused run must NOT be scored. Scoring it silently turns a broken
      // harness into "the agent regressed" — which is the exact confusion this tool exists
      // to prevent. (Seen for real: a shell-mangled prompt produced an 84-char reply that
      // still scored 1/2 on its must_not_match asserts.)
      if (response.trim().length < MIN_RESPONSE_CHARS) {
        throw new Error(`response too short (${response.trim().length} chars) — agent did not answer: ${JSON.stringify(response.slice(0, 120))}`);
      }
      const r = await evaluate(fx, response, agentCmd);
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

  // `--merge` folds this run over an earlier scorecard, replacing by fixture id. It exists for
  // the partial re-run: when a rate limit or a crash cuts a run short, re-running only the
  // affected fixtures and merging is cheaper than repeating all of them — and the merged card
  // still covers every assert, which is what --compare requires.
  let merged = results;
  if (args.merge) {
    if (!existsSync(args.merge)) throw new Error(`--merge file not found: ${args.merge}`);
    const prev = JSON.parse(readFileSync(args.merge, 'utf-8'));
    // The INSTALLED version is what was measured; the repo sha is not. Warn on the one that
    // actually invalidates a merge.
    if (prev.provenance?.installedVersion && provenance.installedVersion
        && prev.provenance.installedVersion !== provenance.installedVersion) {
      console.warn(`  warning: merging across different INSTALLED corpora (${prev.provenance.installedVersion} vs ${provenance.installedVersion}) — the merged scorecard describes no single corpus`);
    }
    const byId = new Map(prev.results.map((r) => [r.id, r]));
    for (const r of results) byId.set(r.id, r);
    merged = [...byId.values()];
    console.log(`merged over ${args.merge}: ${results.length} re-run, ${merged.length} total`);
  }

  const totalAsserts = merged.reduce((s, r) => s + r.total, 0);
  const totalPassed = merged.reduce((s, r) => s + r.passed, 0);
  const scorecard = { provenance, agentCmd: agentCmd.join(' '), totals: { fixtures: merged.length, asserts: totalAsserts, passed: totalPassed }, results: merged };

  console.log(`\n${totalPassed}/${totalAsserts} asserts passed across ${merged.length} fixtures`);

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
    const evaluated = new Set();
    for (const r of merged) {
      for (const a of r.asserts) {
        const key = `${r.id}::${a.id}`;
        evaluated.add(key);
        if (baseByAssert.get(key) === true && a.pass === false) regressions.push({ key, why: a.why });
      }
    }
    // An errored fixture returns NO asserts, so it drops out of the loop above entirely.
    // Without this check a run in which every fixture errored — a rate limit, an expired
    // login, a crashed CLI — reports "no regressions" and exits 0. That is the same false
    // green this tool exists to prevent, so anything the baseline covered and this run did
    // not is reported as UNVERIFIED and fails the run. "We could not measure it" is not
    // "it is fine".
    const unverified = [...baseByAssert.keys()].filter((k) => baseByAssert.get(k) === true && !evaluated.has(k));

    // A regressed assert is RE-RUN before it is believed. The agent is stochastic, so a
    // single failing run is not evidence of a regression — measured on this corpus, the
    // org-space-gate fixture failed once and then passed three consecutive re-runs with the
    // rule text provably untouched. A gate that cries wolf at ~20% gets ignored, which costs
    // more than the extra calls: the verdict is a majority across (1 + confirmRetries) runs,
    // and a split verdict is reported as FLAKY rather than as a regression.
    const flaky = [];
    const unconfirmed = [];
    if (regressions.length && args.confirmRetries > 0) {
      const byFixture = new Map();
      for (const r of regressions) {
        const [fixtureId] = r.key.split('::');
        if (!byFixture.has(fixtureId)) byFixture.set(fixtureId, []);
        byFixture.get(fixtureId).push(r);
      }
      console.log(`\nconfirming ${regressions.length} regression(s) — re-running ${byFixture.size} fixture(s) ${args.confirmRetries}x...`);
      for (const [fixtureId, regs] of byFixture) {
        const fx = fixtures.find((f) => f.id === fixtureId);
        // With `--only`, a regression can come from a fixture carried in by `--merge` that this
        // run did not load, so there is nothing to re-run. Silently skipping left it classified as
        // a CONFIRMED regression on zero confirmation attempts — the same overstatement as counting
        // an errored retry. It is unconfirmed, and the run still fails.
        if (!fx) {
          for (const r of regs) {
            console.log(`    ${r.key}: UNCONFIRMED — not in this run's fixture selection, cannot re-measure`);
            unconfirmed.push(r.key);
            const idx = regressions.findIndex((x) => x.key === r.key);
            if (idx >= 0) regressions.splice(idx, 1);
          }
          continue;
        }
        const tally = new Map(regs.map((r) => [r.key, [false]])); // the run that just failed
        let completed = 0;
        for (let i = 0; i < args.confirmRetries; i++) {
          try {
            const response = await runAgent(agentCmd, fx.prompt + PLAN_ONLY_SUFFIX);
            if (response.trim().length < MIN_RESPONSE_CHARS) throw new Error('response too short');
            const rr = await evaluate(fx, response, agentCmd);
            for (const a of rr.asserts) {
              const key = `${fixtureId}::${a.id}`;
              if (tally.has(key)) tally.get(key).push(a.pass);
            }
            completed++;
          } catch (err) {
            console.log(`    retry ${i + 1} errored: ${err.message}`);
          }
        }
        // An errored retry is NOT evidence. When every retry dies — a rate limit, a refusal, a
        // truncated reply — the only datum left is the single failing run that opened this block,
        // and calling that "fails consistently" is the same false-confidence bug as scoring a
        // truncated response. Observed for real: both Phase 4 regressions reported 0/1 with four
        // errored retries behind them. Unconfirmed still fails the run; it just does not lie about
        // what was measured.
        if (completed === 0) {
          for (const key of tally.keys()) {
            console.log(`    ${key}: UNCONFIRMED — every retry errored, 1 observation only`);
            unconfirmed.push(key);
            const idx = regressions.findIndex((r) => r.key === key);
            if (idx >= 0) regressions.splice(idx, 1);
          }
          continue;
        }
        for (const [key, runs] of tally) {
          const passes = runs.filter(Boolean).length;
          console.log(`    ${key}: ${passes}/${runs.length} passed across runs`);
          if (passes > 0) {
            flaky.push({ key, passes, total: runs.length });
            const idx = regressions.findIndex((r) => r.key === key);
            if (passes * 2 > runs.length && idx >= 0) regressions.splice(idx, 1); // majority pass → not a regression
          }
        }
      }
    }

    console.log(`\nbaseline: ${base.provenance.gitRef}@${base.provenance.gitSha} — ${base.totals.passed}/${base.totals.asserts}`);
    if (flaky.length) {
      console.warn(`\nFLAKY — ${flaky.length} assert(s) disagreed across repeated runs on the SAME corpus:`);
      for (const f of flaky) console.warn(`  ~ ${f.key} (${f.passes}/${f.total} passed)`);
      console.warn('  A gate this unstable cannot distinguish a real regression — tighten the fixture or the assert.');
    }
    if (regressions.length) {
      console.error(`\nREGRESSION — ${regressions.length} assert(s) that passed on the baseline now fail consistently:`);
      for (const r of regressions) console.error(`  ✗ ${r.key}\n      ${r.why}`);
    }
    if (unverified.length) {
      const errored = merged.filter((r) => r.error);
      console.error(`\nUNVERIFIED — ${unverified.length} assert(s) the baseline covered were not measured in this run:`);
      for (const k of unverified) console.error(`  ? ${k}`);
      if (errored.length) {
        console.error(`\n  cause — ${errored.length} fixture(s) errored:`);
        for (const r of errored) console.error(`    ${r.id}: ${r.error}`);
      }
      console.error('\n  This run cannot support a "no regression" claim. Re-run the missing fixtures.');
    }
    if (regressions.length || unverified.length || unconfirmed.length) return 1;
    console.log('no regressions — every baseline assert was measured.');
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err.stack || err.message); process.exit(2); });
