import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planUpdate, runUpdate } from '../src/update.js';
import { listWeeglooSkillDirs, listWeeglooRuleFiles, listWeeglooRuleMarkers } from '../src/io.js';
import { upsertRuleInAgentsMd } from '../src/codex.js';
import { readInstalledRecord } from '../src/self-update.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

// ── planUpdate (pure set arithmetic) ─────────────────────────────────────────

test('planUpdate: keeps the recorded selection, in catalog order', () => {
  const plan = planUpdate({
    catalogSkillIds: ['weegloo-a', 'weegloo-b', 'weegloo-c'],
    catalogRuleIds: [],
    selectedSkillIds: ['weegloo-c', 'weegloo-a'], // scan order ≠ catalog order
    selectedRuleIds: [],
    prevAvailableSkills: ['weegloo-a', 'weegloo-b', 'weegloo-c'],
    prevAvailableRules: [],
  });
  assert.deepEqual(plan.addSkillIds, ['weegloo-a', 'weegloo-c']);
  assert.deepEqual(plan.newSkillIds, [], 'nothing new vs the old catalog');
});

test('planUpdate: auto-adds only items absent from the OLD catalog — deselections stay respected', () => {
  const plan = planUpdate({
    // weegloo-b existed before but the user deselected it; weegloo-new is genuinely new.
    catalogSkillIds: ['weegloo-a', 'weegloo-b', 'weegloo-new'],
    catalogRuleIds: [],
    selectedSkillIds: ['weegloo-a'],
    selectedRuleIds: [],
    prevAvailableSkills: ['weegloo-a', 'weegloo-b'],
    prevAvailableRules: [],
  });
  assert.deepEqual(plan.addSkillIds, ['weegloo-a', 'weegloo-new']);
  assert.deepEqual(plan.newSkillIds, ['weegloo-new']);
});

test('planUpdate: empty prev catalog (legacy record) → no auto-add this cycle', () => {
  const plan = planUpdate({
    catalogSkillIds: ['weegloo-a', 'weegloo-new'],
    catalogRuleIds: [],
    selectedSkillIds: ['weegloo-a'],
    selectedRuleIds: [],
    prevAvailableSkills: [], // unknown offering — cannot tell new from deselected
    prevAvailableRules: [],
  });
  assert.deepEqual(plan.addSkillIds, ['weegloo-a'], 'resync only');
  assert.deepEqual(plan.newSkillIds, []);
});

test('planUpdate: core rules are always re-added, even if absent from the selection', () => {
  const plan = planUpdate({
    catalogSkillIds: [],
    catalogRuleIds: ['weegloo-api-endpoints', 'weegloo-version', 'weegloo-terms-consent'],
    selectedSkillIds: [],
    selectedRuleIds: ['weegloo-api-endpoints'], // user hand-deleted the core rules
    prevAvailableSkills: [],
    prevAvailableRules: ['weegloo-api-endpoints', 'weegloo-version', 'weegloo-terms-consent'],
  });
  assert.deepEqual(plan.addRuleIds, ['weegloo-api-endpoints', 'weegloo-version', 'weegloo-terms-consent']);
});

test('planUpdate: a foreign weegloo-* id in the disk-fallback selection is never in the add set', () => {
  const plan = planUpdate({
    catalogSkillIds: ['weegloo-a'],
    catalogRuleIds: [],
    selectedSkillIds: ['weegloo-a', 'weegloo-my-own-thing'],
    selectedRuleIds: [],
    prevAvailableSkills: ['weegloo-a'],
    prevAvailableRules: [],
  });
  assert.deepEqual(plan.addSkillIds, ['weegloo-a']);
});

// ── disk-detection helpers (prefix scan) ─────────────────────────────────────

test('listWeeglooSkillDirs: weegloo-* directories only (files and foreign names excluded)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-detect-'));
  try {
    fs.mkdirSync(path.join(dir, 'weegloo-a'));
    fs.mkdirSync(path.join(dir, 'not-weegloo'));
    fs.writeFileSync(path.join(dir, 'weegloo-file-not-dir'), '', 'utf-8');
    assert.deepEqual(listWeeglooSkillDirs(dir), ['weegloo-a']);
    assert.deepEqual(listWeeglooSkillDirs(path.join(dir, 'missing')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listWeeglooRuleFiles: strips the extension, ignores other suffixes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-detect-'));
  try {
    fs.writeFileSync(path.join(dir, 'weegloo-r1.md'), 'x', 'utf-8');
    fs.writeFileSync(path.join(dir, 'weegloo-r2.mdc'), 'x', 'utf-8');
    fs.writeFileSync(path.join(dir, 'unrelated.md'), 'x', 'utf-8');
    assert.deepEqual(listWeeglooRuleFiles(dir, 'md'), ['weegloo-r1']);
    assert.deepEqual(listWeeglooRuleFiles(dir, '.mdc'), ['weegloo-r2']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listWeeglooRuleMarkers: reads marker ids out of a shared context file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-detect-'));
  const file = path.join(dir, 'AGENTS.md');
  try {
    upsertRuleInAgentsMd(file, 'weegloo-version', 'v-content');
    upsertRuleInAgentsMd(file, 'weegloo-global-rules', 'g-content');
    assert.deepEqual(listWeeglooRuleMarkers(file), ['weegloo-version', 'weegloo-global-rules']);
    assert.deepEqual(listWeeglooRuleMarkers(path.join(dir, 'missing.md')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── runUpdate (integration, project scope in a temp cwd) ─────────────────────
// node --test runs each test FILE in its own process, and tests in a file run sequentially,
// so process.chdir here cannot race another file's cwd.

const MANIFEST = {
  version: 'v2',
  skills: [
    { id: 'weegloo-a', files: { 'SKILL.md': 'a v2' } },
    { id: 'weegloo-b', files: { 'SKILL.md': 'b v2' } },
    { id: 'weegloo-brandnew', files: { 'SKILL.md': 'new v2' } },
  ],
  rules: [
    { id: 'weegloo-version', content: 'version-rule {{WEEGLOO_VERSION_URL}} {{WEEGLOO_STAMP_PATH}} {{WEEGLOO_UPDATE_COMMAND}} {{WEEGLOO_CHECK_INTERVAL_HOURS}}' },
    { id: 'weegloo-terms-consent', content: 'terms-rule v2' },
    { id: 'weegloo-global-rules', content: 'global-rule v2' },
  ],
};

async function inTmpProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-update-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir); // await BEFORE the finally — fn is async and uses the tmp cwd throughout
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const quiet = { log: () => {} };
const loadOk = async () => MANIFEST;

/** Seeds a claude project-scope install: selected skills/rules on disk + per-agent state. */
function seedClaude({ skills = [], rules = [], record = null, stamp = null } = {}) {
  for (const id of skills) {
    fs.mkdirSync(path.join('.claude', 'skills', id), { recursive: true });
    fs.writeFileSync(path.join('.claude', 'skills', id, 'SKILL.md'), `${id} v1`, 'utf-8');
  }
  fs.mkdirSync(path.join('.claude', 'rules'), { recursive: true });
  for (const id of rules) {
    fs.writeFileSync(path.join('.claude', 'rules', `${id}.md`), `${id} v1`, 'utf-8');
  }
  if (record) {
    fs.mkdirSync(path.join('.weegloo', 'claude'), { recursive: true });
    fs.writeFileSync(path.join('.weegloo', 'claude', 'installed.json'), JSON.stringify(record), 'utf-8');
  }
  if (stamp) {
    fs.mkdirSync(path.join('.weegloo', 'claude'), { recursive: true });
    fs.writeFileSync(path.join('.weegloo', 'claude', 'version-check.json'), JSON.stringify(stamp), 'utf-8');
  }
}

test('runUpdate: nothing installed → no-op with guidance, nothing created', async () => {
  await inTmpProject(async () => {
    const lines = [];
    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, log: (s) => lines.push(String(s)) }
    );
    assert.equal(res.status, 'nothing-installed');
    assert.ok(lines.some((l) => l.includes('Nothing to update')));
    assert.equal(fs.existsSync('.weegloo'), false, 'no state files created');
  });
});

test('runUpdate: keeps selection, refreshes content, auto-adds new, prunes upstream-deleted', async () => {
  await inTmpProject(async () => {
    // v1 install: user selected a + gone (gone is deleted upstream in v2); catalog knew a,b,gone.
    seedClaude({
      skills: ['weegloo-a', 'weegloo-gone'],
      rules: ['weegloo-version', 'weegloo-terms-consent'],
      record: {
        skills: ['weegloo-a', 'weegloo-gone'],
        rules: ['weegloo-version', 'weegloo-terms-consent'],
        availableSkills: ['weegloo-a', 'weegloo-b', 'weegloo-gone'],
        availableRules: ['weegloo-version', 'weegloo-terms-consent', 'weegloo-global-rules'],
      },
      stamp: { last_check: '2026-01-01T00:00:00', version: 'v1', ref: 'develop' },
    });

    let requestedRef = null;
    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: async (ref) => ((requestedRef = ref), MANIFEST), ...quiet }
    );

    assert.equal(res.status, 'updated');
    assert.equal(requestedRef, 'develop', 'branch came from the agent stamp, not latest');
    // selection kept + refreshed to v2 content
    assert.equal(fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8'), 'a v2');
    // deselected-before weegloo-b stays out; brand-new (absent from old catalog) auto-added
    assert.equal(fs.existsSync('.claude/skills/weegloo-b'), false, 'old deselection respected');
    assert.equal(fs.readFileSync('.claude/skills/weegloo-brandnew/SKILL.md', 'utf-8'), 'new v2');
    // upstream-deleted pruned
    assert.equal(fs.existsSync('.claude/skills/weegloo-gone'), false);
    // rules: kept ones refreshed and templated with the stamp's ref
    const versionRule = fs.readFileSync('.claude/rules/weegloo-version.md', 'utf-8');
    assert.ok(versionRule.includes('?branch=develop'), 'check URL branch-scoped to develop');
    assert.ok(versionRule.includes('--branch develop --location project --update'), 'baked command');
    assert.ok(versionRule.includes('.weegloo/claude/version-check.json'), 'per-agent stamp path');
    // global-rules was offered before and not installed → stays out (not core)
    assert.equal(fs.existsSync('.claude/rules/weegloo-global-rules.md'), false);
    // record + stamp advanced
    const rec = readInstalledRecord('.weegloo/claude/installed.json');
    assert.deepEqual(rec.skills, ['weegloo-a', 'weegloo-brandnew']);
    assert.deepEqual(rec.availableSkills, ['weegloo-a', 'weegloo-b', 'weegloo-brandnew']);
    const stamp = readJson('.weegloo/claude/version-check.json');
    assert.equal(stamp.version, 'v2');
    assert.equal(stamp.ref, 'develop');
  });
});

test('runUpdate: core rules are restored even after the user hand-deleted them', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-a'],
      rules: [], // rules dir exists but user wiped everything… except detection needs ≥1 weegloo rule
      record: {
        skills: ['weegloo-a'],
        rules: ['weegloo-version'],
        availableSkills: ['weegloo-a'],
        availableRules: ['weegloo-version', 'weegloo-terms-consent', 'weegloo-global-rules'],
      },
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });
    // one surviving weegloo rule so the rules kind counts as installed
    fs.writeFileSync('.claude/rules/weegloo-terms-consent.md', 'terms v1', 'utf-8');

    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, ...quiet }
    );

    assert.ok(fs.existsSync('.claude/rules/weegloo-version.md'), 'deleted core rule came back');
    assert.ok(fs.existsSync('.claude/rules/weegloo-terms-consent.md'));
  });
});

test('runUpdate: legacy flat record (pre per-agent) → resync without auto-add, catalog snapshotted', async () => {
  await inTmpProject(async () => {
    // Pre-migration state: files on disk + ONLY the legacy flat record; no per-agent dir at all.
    seedClaude({ skills: ['weegloo-a', 'weegloo-gone'], rules: ['weegloo-version'] });
    fs.mkdirSync('.weegloo', { recursive: true });
    fs.writeFileSync(
      '.weegloo/installed.json',
      JSON.stringify({ skills: ['weegloo-a', 'weegloo-gone'], rules: ['weegloo-version'] }),
      'utf-8'
    );

    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, ...quiet }
    );

    assert.equal(res.status, 'updated');
    // no catalog back then → brand-new NOT auto-added this cycle
    assert.equal(fs.existsSync('.claude/skills/weegloo-brandnew'), false);
    // but the legacy record still drove pruning of the upstream-deleted skill
    assert.equal(fs.existsSync('.claude/skills/weegloo-gone'), false);
    // per-agent record now has the catalog snapshot → next cycle auto-adds precisely
    const rec = readInstalledRecord('.weegloo/claude/installed.json');
    assert.deepEqual(rec.availableSkills, ['weegloo-a', 'weegloo-b', 'weegloo-brandnew']);
    // legacy file untouched (other agents' first migrations still need it)
    assert.deepEqual(readJson('.weegloo/installed.json').skills, ['weegloo-a', 'weegloo-gone']);
  });
});

test('runUpdate: manifest unavailable → nothing on disk is touched', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-a'],
      rules: ['weegloo-version'],
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });
    const before = fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8');

    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: async () => null, ...quiet }
    );

    assert.equal(res.ok, false);
    assert.equal(res.status, 'manifest-unavailable');
    assert.equal(fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8'), before);
    assert.equal(readJson('.weegloo/claude/version-check.json').version, 'v1', 'stamp not advanced');
  });
});

test('runUpdate: --branch flag overrides the stamp ref', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-a'], stamp: { last_check: 'x', version: 'v1', ref: 'develop' } });
    let requestedRef = null;
    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true, pluginRef: '1.1.2' },
      { loadResourcesFn: async (ref) => ((requestedRef = ref), MANIFEST), ...quiet }
    );
    assert.equal(requestedRef, '1.1.2');
  });
});

test('runUpdate: no stamp ref (pre-migration) falls back to latest', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-a'] });
    let requestedRef = null;
    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: async (ref) => ((requestedRef = ref), MANIFEST), ...quiet }
    );
    assert.equal(requestedRef, 'latest');
  });
});

test('runUpdate: --ignore-rule limits the update to skills', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-a'],
      rules: ['weegloo-version'],
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });
    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true, ignoreRule: true },
      { loadResourcesFn: loadOk, ...quiet }
    );
    assert.equal(fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8'), 'a v2');
    assert.equal(fs.readFileSync('.claude/rules/weegloo-version.md', 'utf-8'), 'weegloo-version v1', 'rules untouched');
  });
});

test('runUpdate: a rules-less install stays rules-less (no core force-in on an opted-out kind)', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-a'] }); // installed with --ignore-rule back then
    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, ...quiet }
    );
    assert.equal(fs.existsSync('.claude/rules/weegloo-version.md'), false, 'opt-out respected');
  });
});

// ── shared-store conflict (project scope, marker agents) ─────────────────────

/** Seeds an androidstudio project install (private skills dir + shared AGENTS.md rules). */
function seedAndroidStudio() {
  fs.mkdirSync(path.join('.android-studio', 'skills', 'weegloo-a'), { recursive: true });
  fs.writeFileSync(path.join('.android-studio', 'skills', 'weegloo-a', 'SKILL.md'), 'a v1', 'utf-8');
  upsertRuleInAgentsMd(path.join(process.cwd(), 'AGENTS.md'), 'weegloo-version', 'v1 rule');
  fs.mkdirSync(path.join('.weegloo', 'androidstudio'), { recursive: true });
  fs.writeFileSync(
    path.join('.weegloo', 'androidstudio', 'version-check.json'),
    JSON.stringify({ last_check: 'x', version: 'v1', ref: 'latest' }),
    'utf-8'
  );
}

/** Marks codex as installed in this project on a DIFFERENT branch. */
function seedCodexStampOn(ref) {
  fs.mkdirSync(path.join('.weegloo', 'codex'), { recursive: true });
  fs.writeFileSync(
    path.join('.weegloo', 'codex', 'version-check.json'),
    JSON.stringify({ last_check: 'x', version: 'v1', ref }),
    'utf-8'
  );
}

test('runUpdate: shared AGENTS.md + diverging sharer branch → non-interactive warns and proceeds (last write wins)', async () => {
  await inTmpProject(async () => {
    seedAndroidStudio();
    seedCodexStampOn('develop'); // androidstudio is on latest → conflict

    const lines = [];
    const res = await runUpdate(
      { update: true, agent: 'androidstudio', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, log: (s) => lines.push(String(s)) }
    );

    assert.equal(res.status, 'updated');
    assert.ok(lines.some((l) => l.includes('codex(develop)') && l.includes('last write wins')));
    const agents = fs.readFileSync('AGENTS.md', 'utf-8');
    assert.ok(agents.includes('?branch=latest'), 'shared rules rewritten with MY branch content');
  });
});

test('runUpdate: conflict in a TTY → "skip" updates private stores but leaves shared ones untouched', async () => {
  await inTmpProject(async () => {
    seedAndroidStudio();
    seedCodexStampOn('develop');
    const agentsBefore = fs.readFileSync('AGENTS.md', 'utf-8');

    const res = await runUpdate(
      { update: true, agent: 'androidstudio', scope: 'project', nonInteractive: false },
      { loadResourcesFn: loadOk, promptSelect: async () => 'skip', ...quiet }
    );

    assert.equal(res.status, 'updated');
    assert.equal(fs.readFileSync('AGENTS.md', 'utf-8'), agentsBefore, 'shared rules untouched');
    assert.equal(
      fs.readFileSync('.android-studio/skills/weegloo-a/SKILL.md', 'utf-8'),
      'a v2',
      'private skills still updated'
    );
  });
});

test('runUpdate: conflict in a TTY → "abort" changes nothing', async () => {
  await inTmpProject(async () => {
    seedAndroidStudio();
    seedCodexStampOn('develop');
    const agentsBefore = fs.readFileSync('AGENTS.md', 'utf-8');

    const res = await runUpdate(
      { update: true, agent: 'androidstudio', scope: 'project', nonInteractive: false },
      { loadResourcesFn: loadOk, promptSelect: async () => 'abort', ...quiet }
    );

    assert.equal(res.status, 'aborted');
    assert.equal(fs.readFileSync('AGENTS.md', 'utf-8'), agentsBefore);
    assert.equal(fs.readFileSync('.android-studio/skills/weegloo-a/SKILL.md', 'utf-8'), 'a v1');
  });
});

test('runUpdate: sharers on the SAME branch are not a conflict', async () => {
  await inTmpProject(async () => {
    seedAndroidStudio();
    seedCodexStampOn('latest'); // same ref as androidstudio → no conflict, no prompt
    let prompted = false;

    const res = await runUpdate(
      { update: true, agent: 'androidstudio', scope: 'project', nonInteractive: false },
      { loadResourcesFn: loadOk, promptSelect: async () => ((prompted = true), 'abort'), ...quiet }
    );

    assert.equal(res.status, 'updated');
    assert.equal(prompted, false);
  });
});

// ── record authority (selection = installed.json, disk = drift to repair) ────

test('runUpdate: a hand-deleted skill is RESTORED from the record (drift repair, not deselection)', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-a'],
      rules: ['weegloo-version'],
      record: {
        skills: ['weegloo-a'],
        rules: ['weegloo-version'],
        availableSkills: ['weegloo-a', 'weegloo-b', 'weegloo-brandnew'],
        availableRules: ['weegloo-version', 'weegloo-terms-consent', 'weegloo-global-rules'],
      },
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });
    fs.rmSync('.claude/skills/weegloo-a', { recursive: true, force: true }); // "accidental" delete

    const lines = [];
    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, log: (s) => lines.push(String(s)) }
    );

    assert.equal(res.status, 'updated');
    assert.equal(fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8'), 'a v2', 'restored');
    assert.ok(lines.some((l) => l.includes('restored') && l.includes('weegloo-a')), 'restore is reported');
    assert.deepEqual(
      readInstalledRecord('.weegloo/claude/installed.json').skills,
      ['weegloo-a'],
      'record keeps the selection'
    );
  });
});

test('runUpdate: record authority — a checkbox-deselected item stays out even if its files linger on disk', async () => {
  await inTmpProject(async () => {
    // The user deselected weegloo-b via a reinstall, but its dir was left behind (e.g. copied
    // back by hand, or a failed cleanup). The record — not the disk — decides the selection.
    seedClaude({
      skills: ['weegloo-a', 'weegloo-b'],
      rules: ['weegloo-version'],
      record: {
        skills: ['weegloo-a'], // b NOT selected
        rules: ['weegloo-version'],
        availableSkills: ['weegloo-a', 'weegloo-b', 'weegloo-brandnew'], // full old catalog → no auto-add noise
        availableRules: ['weegloo-version'],
      },
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });

    await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, ...quiet }
    );

    // b was not selected → not synced to v2; its stray dir is not weegloo-managed per the
    // record, so it is left alone (never deleted, never overwritten).
    assert.equal(fs.readFileSync('.claude/skills/weegloo-b/SKILL.md', 'utf-8'), 'weegloo-b v1');
    assert.deepEqual(readInstalledRecord('.weegloo/claude/installed.json').skills, ['weegloo-a']);
  });
});

test('runUpdate: full skills wipe with an intact record → everything restored', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-a', 'weegloo-b'],
      rules: ['weegloo-version'],
      record: {
        skills: ['weegloo-a', 'weegloo-b'],
        rules: ['weegloo-version'],
        availableSkills: ['weegloo-a', 'weegloo-b'],
        availableRules: ['weegloo-version'],
      },
      stamp: { last_check: 'x', version: 'v1', ref: 'latest' },
    });
    fs.rmSync('.claude/skills', { recursive: true, force: true });

    const res = await runUpdate(
      { update: true, agent: 'claude', scope: 'project', nonInteractive: true },
      { loadResourcesFn: loadOk, ...quiet }
    );

    assert.equal(res.status, 'updated');
    assert.equal(fs.readFileSync('.claude/skills/weegloo-a/SKILL.md', 'utf-8'), 'a v2');
    assert.equal(fs.readFileSync('.claude/skills/weegloo-b/SKILL.md', 'utf-8'), 'b v2');
  });
});
