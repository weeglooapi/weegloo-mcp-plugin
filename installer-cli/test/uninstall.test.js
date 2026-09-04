import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  detectInstall,
  listMcpServers,
  pruneEmptyDirs,
  removeMcpServers,
  runUninstall,
  uninstallTarget,
} from '../src/uninstall.js';
import { getAgentStore } from '../src/stores.js';
import { readInstalledRecord } from '../src/self-update.js';
import { upsertRuleInAgentsMd } from '../src/codex.js';
import { RULE_LOADING_ID, RULE_LOADING_CONTENT } from '../src/antigravity.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

/** Makes a temp dir, runs fn(dir), always cleans up. */
function withTmp(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// node --test runs each test FILE in its own process, and tests in a file run sequentially,
// so process.chdir here cannot race another file's cwd.
async function inTmpProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-uninstall-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(fs.realpathSync(dir));
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs fn with a throwaway home directory.
 *
 * REQUIRED for any global-scope test. Global paths are derived from `os.homedir()`, which reads
 * $HOME / %USERPROFILE% at call time — so a global-scope test without this scans the developer's
 * REAL install, and an uninstall test will cheerfully delete it. (cursor.js caches its home at
 * import time, so cursor global cannot be faked this way and stays out of these tests.)
 */
async function withFakeHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-home-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    assert.equal(fs.realpathSync(os.homedir()), fs.realpathSync(home), 'fake home is in effect');
    return await fn(fs.realpathSync(home));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const quiet = { log: () => {} };

/**
 * Every test pins --agent AND a scope. An unpinned scope makes detection scan the home
 * directory too, which must only ever happen inside withFakeHome (see above).
 */
const cfg = (over = {}) => ({
  uninstall: true,
  nonInteractive: true,
  scope: 'project',
  uninstallMcp: true,
  uninstallSkills: true,
  uninstallRules: true,
  ...over,
});

function writeSkill(skillsDir, id) {
  fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, id, 'SKILL.md'), `# ${id}\n`, 'utf-8');
}

function writeState(agent, { record = null, stamp = null } = {}) {
  const dir = path.join('.weegloo', agent);
  fs.mkdirSync(dir, { recursive: true });
  if (record) fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify(record), 'utf-8');
  if (stamp) fs.writeFileSync(path.join(dir, 'version-check.json'), JSON.stringify(stamp), 'utf-8');
}

/** Seeds a claude project-scope install: skills, rules, .mcp.json and per-agent state. */
function seedClaude({ skills = [], rules = [], record = undefined, mcp = true } = {}) {
  for (const id of skills) writeSkill(path.join('.claude', 'skills'), id);
  fs.mkdirSync(path.join('.claude', 'rules'), { recursive: true });
  for (const id of rules) {
    fs.writeFileSync(path.join('.claude', 'rules', `${id}.md`), `${id} body`, 'utf-8');
  }
  if (mcp) {
    fs.writeFileSync(
      '.mcp.json',
      JSON.stringify({
        mcpServers: {
          weegloo: { type: 'http', url: 'https://ai.weegloo.com/mcp' },
          'weegloo-upload': { command: 'cmd', env: { AUTH_BEARER_TOKEN: 'secret-pat' } },
        },
      }),
      'utf-8'
    );
  }
  writeState('claude', {
    record:
      record === undefined
        ? { skills, rules, availableSkills: skills, availableRules: rules }
        : record,
    stamp: { last_check: '2026-01-01T00:00:00', version: 'v1', ref: 'latest' },
  });
}

// ── removeMcpServers ─────────────────────────────────────────────────────────

test('removeMcpServers (json): drops only the weegloo entries, keeps other servers', () => {
  withTmp('weegloo-mcp-json-', (root) => {
    const file = path.join(root, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: { weegloo: {}, 'weegloo-upload': {}, other: { command: 'node' } },
        someOtherSetting: true,
      }),
      'utf-8'
    );

    const result = removeMcpServers({ kind: 'json', file, container: 'mcpServers' });

    assert.deepEqual(result.removed, ['weegloo', 'weegloo-upload']);
    assert.deepEqual(readJson(file), {
      mcpServers: { other: { command: 'node' } },
      someOtherSetting: true,
    });
  });
});

test('removeMcpServers (json): KEEPS a file the removal empties out — it may not be ours', () => {
  withTmp('weegloo-mcp-json-', (root) => {
    const file = path.join(root, '.mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { weegloo: {}, 'weegloo-upload': {} } }), 'utf-8');

    const result = removeMcpServers({ kind: 'json', file, container: 'mcpServers' });

    assert.deepEqual(result.removed, ['weegloo', 'weegloo-upload']);
    // Deleting it took a repo-COMMITTED .mcp.json once. Nothing records who created the file,
    // so an untidy {} is the correct outcome and the deletion is not.
    assert.equal(fs.existsSync(file), true);
    assert.deepEqual(readJson(file), {});
  });
});

test('removeMcpServers (json): no weegloo entries → nothing removed, file untouched', () => {
  withTmp('weegloo-mcp-json-', (root) => {
    const file = path.join(root, 'mcp.json');
    const before = JSON.stringify({ mcpServers: { other: {} } });
    fs.writeFileSync(file, before, 'utf-8');

    const result = removeMcpServers({ kind: 'json', file, container: 'mcpServers' });

    assert.deepEqual(result.removed, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), before, 'byte-identical');
  });
});

test('removeMcpServers (toml): strips the weegloo tables and keeps the rest', () => {
  withTmp('weegloo-mcp-toml-', (root) => {
    const file = path.join(root, 'config.toml');
    fs.writeFileSync(
      file,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.weegloo]',
        'url = "https://ai.weegloo.com/mcp"',
        '',
        '[mcp_servers.weegloo-upload]',
        'command = "cmd"',
        '',
        '[mcp_servers.weegloo-upload.env]',
        'AUTH_BEARER_TOKEN = "secret-pat"',
        '',
        '[projects."/tmp/app"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = removeMcpServers({ kind: 'toml', file });

    assert.deepEqual(result.removed, ['weegloo', 'weegloo-upload']);
    const body = fs.readFileSync(file, 'utf-8');
    assert.ok(!body.includes('weegloo'), 'no weegloo table or token left behind');
    assert.ok(body.includes('model = "gpt-5"'));
    assert.ok(body.includes('[projects."/tmp/app"]'), 'the user\'s trust entry survives');
  });
});

test('removeMcpServers (toml): empties a config.toml that held nothing but weegloo, keeps the file', () => {
  withTmp('weegloo-mcp-toml-', (root) => {
    const file = path.join(root, 'config.toml');
    fs.writeFileSync(file, '[mcp_servers.weegloo]\nurl = "x"\n', 'utf-8');
    const result = removeMcpServers({ kind: 'toml', file });
    assert.deepEqual(result.removed, ['weegloo']);
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.readFileSync(file, 'utf-8'), '');
  });
});

test('listMcpServers: reports what is actually configured (json + toml + missing file)', () => {
  withTmp('weegloo-mcp-list-', (root) => {
    const json = path.join(root, 'mcp.json');
    fs.writeFileSync(json, JSON.stringify({ mcpServers: { weegloo: {}, other: {} } }), 'utf-8');
    assert.deepEqual(listMcpServers({ kind: 'json', file: json, container: 'mcpServers' }), ['weegloo']);

    const toml = path.join(root, 'config.toml');
    fs.writeFileSync(toml, '[mcp_servers.weegloo-upload]\ncommand = "cmd"\n', 'utf-8');
    assert.deepEqual(listMcpServers({ kind: 'toml', file: toml }), ['weegloo-upload']);

    assert.deepEqual(listMcpServers({ kind: 'json', file: path.join(root, 'nope.json') }), []);
  });
});

// ── pruneEmptyDirs ───────────────────────────────────────────────────────────

test('pruneEmptyDirs: removes the dir and every empty parent, stopping at the root', () => {
  withTmp('weegloo-prune-', (root) => {
    const leaf = path.join(root, '.claude', 'skills');
    fs.mkdirSync(leaf, { recursive: true });

    const removed = pruneEmptyDirs(leaf, root);

    assert.deepEqual(removed, [leaf, path.join(root, '.claude')]);
    assert.equal(fs.existsSync(root), true, 'the root itself is never taken');
  });
});

test('pruneEmptyDirs: stops at the first parent that still holds something', () => {
  withTmp('weegloo-prune-', (root) => {
    const leaf = path.join(root, '.claude', 'skills');
    fs.mkdirSync(leaf, { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}', 'utf-8');

    assert.deepEqual(pruneEmptyDirs(leaf, root), [leaf]);
    assert.equal(fs.existsSync(path.join(root, '.claude')), true);
  });
});

test('pruneEmptyDirs: a non-empty dir and a missing dir are both no-ops', () => {
  withTmp('weegloo-prune-', (root) => {
    const leaf = path.join(root, 'skills', 'mine');
    fs.mkdirSync(leaf, { recursive: true });
    assert.deepEqual(pruneEmptyDirs(path.join(root, 'skills'), root), []);
    assert.deepEqual(pruneEmptyDirs(path.join(root, 'gone'), root), []);
  });
});

// ── detectInstall ────────────────────────────────────────────────────────────

test('detectInstall: reports skills, rules, MCP and state — and unions record with disk', async () => {
  await inTmpProject(async () => {
    seedClaude({
      skills: ['weegloo-script'],
      rules: ['weegloo-version'],
      // the record also claims an id that is gone from disk, and disk has one it never knew
      record: { skills: ['weegloo-script', 'weegloo-recorded-only'], rules: ['weegloo-version'] },
    });
    writeSkill(path.join('.claude', 'skills'), 'weegloo-disk-only');

    const detected = detectInstall('claude', 'project');

    assert.equal(detected.present, true);
    assert.equal(detected.strong, true);
    // the record is the authority — a recorded id absent from disk stays in (harmless no-op)…
    assert.deepEqual(detected.skills.sort(), ['weegloo-recorded-only', 'weegloo-script']);
    // …and a weegloo-looking dir the record never claimed is UNVERIFIED, not removable
    assert.deepEqual(detected.unverifiedSkills, ['weegloo-disk-only']);
    assert.deepEqual(detected.rules, ['weegloo-version']);
    assert.deepEqual(detected.mcpServers, ['weegloo', 'weegloo-upload']);
    assert.equal(detected.hasRecord, true);
    assert.equal(detected.hasStamp, true);
  });
});

test('detectInstall: a clean project is not present', async () => {
  await inTmpProject(async () => {
    const detected = detectInstall('claude', 'project');
    assert.equal(detected.present, false);
    assert.deepEqual(detected.skills, []);
    assert.deepEqual(detected.unverifiedSkills, []);
    assert.deepEqual(detected.mcpServers, []);
  });
});

test('detectInstall: markers in the SHARED AGENTS.md are weak evidence, not proof', async () => {
  await inTmpProject(async () => {
    // Only Android Studio was installed; its rules live in the marker file codex also uses.
    upsertRuleInAgentsMd('AGENTS.md', 'weegloo-global-rules', 'rules body');

    const codex = detectInstall('codex', 'project');
    assert.equal(codex.present, true, 'still offered — the markers may be codex\'s');
    assert.equal(codex.strong, false, 'but not checked by default');
    assert.deepEqual(codex.rules, [], 'no record ⇒ nothing is removable without being picked');
    assert.deepEqual(codex.unverifiedRules, ['weegloo-global-rules']);

    const androidstudio = detectInstall('androidstudio', 'project');
    assert.equal(androidstudio.strong, false, 'same file, same ambiguity');
  });
});

test("detectInstall: antigravity's own .agents/rules files ARE strong evidence", async () => {
  await inTmpProject(async () => {
    fs.mkdirSync(path.join('.agents', 'rules'), { recursive: true });
    fs.writeFileSync(path.join('.agents', 'rules', 'weegloo-version.md'), 'body', 'utf-8');
    const detected = detectInstall('antigravity', 'project');
    assert.equal(detected.strong, true);
    assert.deepEqual(detected.unverifiedRules, ['weegloo-version'], 'no record yet ⇒ unverified');
  });
});

// ── uninstallTarget ──────────────────────────────────────────────────────────

test('uninstallTarget: removes weegloo skills/rules/MCP/state and nothing of the user\'s', async () => {
  await inTmpProject(async (root) => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version', 'weegloo-global-rules'] });
    writeSkill(path.join('.claude', 'skills'), 'my-own-skill');
    fs.writeFileSync(path.join('.claude', 'rules', 'my-rule.md'), 'mine', 'utf-8');

    const report = uninstallTarget(detectInstall('claude', 'project'));

    assert.deepEqual(report.removedSkills, ['weegloo-script']);
    assert.deepEqual(report.removedRules.sort(), ['weegloo-global-rules', 'weegloo-version']);
    assert.deepEqual(report.mcp.removed, ['weegloo', 'weegloo-upload']);
    assert.equal(fs.existsSync('.mcp.json'), true, 'the config file is the user\'s, not ours');
    assert.deepEqual(readJson('.mcp.json'), {}, 'but the entries — and the token — are gone');
    assert.equal(fs.existsSync('.weegloo'), false, 'tracking state cleared');
    // the user's own files, and the dirs holding them, survive
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'my-own-skill', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join('.claude', 'rules', 'my-rule.md')), true);
    assert.equal(fs.existsSync(root), true);
  });
});

test('uninstallTarget: empty dirs left behind by the removal are pruned', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });

    uninstallTarget(detectInstall('claude', 'project'));

    assert.equal(fs.existsSync('.claude'), false, '.claude/skills, .claude/rules and .claude all go');
  });
});

test('uninstallTarget: --ignore-rule keeps the rules AND empties only the skills record', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });

    const report = uninstallTarget(detectInstall('claude', 'project'), { rules: false });

    assert.deepEqual(report.removedSkills, ['weegloo-script']);
    assert.deepEqual(report.removedRules, []);
    assert.equal(fs.existsSync(path.join('.claude', 'rules', 'weegloo-version.md')), true);
    // the record survives (rules are still installed) with the skills side cleared, so a later
    // --update does not read the removal as drift and restore them
    const record = readInstalledRecord(path.join('.weegloo', 'claude', 'installed.json'));
    assert.deepEqual(record.skills, []);
    assert.deepEqual(record.availableSkills, []);
    assert.deepEqual(record.rules, ['weegloo-version']);
  });
});

test('uninstallTarget: --no-mcp leaves the MCP config alone', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });

    const report = uninstallTarget(detectInstall('claude', 'project'), { mcp: false });

    assert.deepEqual(report.mcp.removed, []);
    assert.deepEqual(Object.keys(readJson('.mcp.json').mcpServers), ['weegloo', 'weegloo-upload']);
  });
});

test('uninstallTarget (codex): cuts the rule markers out of AGENTS.md, keeps the user\'s prose', async () => {
  await inTmpProject(async () => {
    fs.writeFileSync('AGENTS.md', '# My project\n\nHouse rules here.\n', 'utf-8');
    upsertRuleInAgentsMd('AGENTS.md', 'weegloo-version', 'version rule');
    upsertRuleInAgentsMd('AGENTS.md', 'weegloo-global-rules', 'global rule');
    fs.mkdirSync(path.join('.codex'), { recursive: true });
    fs.writeFileSync(
      path.join('.codex', 'config.toml'),
      '[mcp_servers.weegloo]\nurl = "x"\n\n[mcp_servers.weegloo-upload]\ncommand = "cmd"\n',
      'utf-8'
    );
    writeState('codex', {
      record: { skills: [], rules: ['weegloo-version', 'weegloo-global-rules'] },
    });

    const report = uninstallTarget(detectInstall('codex', 'project'));

    assert.deepEqual(report.removedRules.sort(), ['weegloo-global-rules', 'weegloo-version']);
    const body = fs.readFileSync('AGENTS.md', 'utf-8');
    assert.ok(!body.includes('weegloo:'), 'no marker sections left');
    assert.ok(body.includes('House rules here.'), 'hand-written prose preserved');
    assert.equal(fs.readFileSync(path.join('.codex', 'config.toml'), 'utf-8'), '', 'emptied, not deleted');
  });
});

test('uninstallTarget (codex): an AGENTS.md left with no content is emptied, NOT deleted', async () => {
  await inTmpProject(async () => {
    upsertRuleInAgentsMd('AGENTS.md', 'weegloo-version', 'version rule');
    writeState('codex', { record: { skills: [], rules: ['weegloo-version'] } });

    uninstallTarget(detectInstall('codex', 'project'));

    // AGENTS.md is a file agents and humans both own; we cut our sections and stop there.
    assert.equal(fs.existsSync('AGENTS.md'), true);
    assert.equal(fs.readFileSync('AGENTS.md', 'utf-8').replace(/^﻿/, '').trim(), '');
  });
});

test('uninstallTarget: a shared skill another agent still claims is left in place', async () => {
  await inTmpProject(async () => {
    // codex and antigravity both keep project skills in .agents/skills
    const shared = path.join('.agents', 'skills');
    writeSkill(shared, 'weegloo-script');
    writeState('codex', { record: { skills: ['weegloo-script'], rules: [] } });
    writeState('antigravity', { record: { skills: ['weegloo-script'], rules: [] } });

    const codexReport = uninstallTarget(detectInstall('codex', 'project'));

    assert.deepEqual(codexReport.removedSkills, [], 'antigravity still uses the file');
    assert.deepEqual(codexReport.keptSkills, ['weegloo-script']);
    assert.equal(fs.existsSync(path.join(shared, 'weegloo-script')), true);
    assert.equal(fs.existsSync(path.join('.weegloo', 'codex')), false, 'codex still let go of it');

    // the LAST claimer frees the shared file
    const antigravityReport = uninstallTarget(detectInstall('antigravity', 'project'));
    assert.deepEqual(antigravityReport.removedSkills, ['weegloo-script']);
    assert.equal(fs.existsSync('.agents'), false);
  });
});

test('uninstallTarget (antigravity): removes .agents/rules files and the AGENTS.md loader', async () => {
  await inTmpProject(async () => {
    fs.mkdirSync(path.join('.agents', 'rules'), { recursive: true });
    fs.writeFileSync(path.join('.agents', 'rules', 'weegloo-version.md'), 'body', 'utf-8');
    upsertRuleInAgentsMd('AGENTS.md', RULE_LOADING_ID, RULE_LOADING_CONTENT);
    writeState('antigravity', { record: { skills: [], rules: ['weegloo-version'] } });

    const report = uninstallTarget(detectInstall('antigravity', 'project'));

    assert.deepEqual(report.removedRules, ['weegloo-version']);
    assert.equal(fs.existsSync('.agents'), false, 'the emptied rules dir and .agents are pruned');
    // the loader marker is ours and goes; the file itself is left behind, emptied
    assert.ok(!fs.readFileSync('AGENTS.md', 'utf-8').includes('weegloo:'));
  });
});

test('uninstallTarget (antigravity): pre-migration markers go only when the record claims them', async () => {
  await inTmpProject(async () => {
    // A legacy install kept the rules themselves as markers in the shared context file.
    upsertRuleInAgentsMd('AGENTS.md', 'weegloo-version', 'legacy version rule');
    fs.writeFileSync('AGENTS.md', `${fs.readFileSync('AGENTS.md', 'utf-8')}\nKeep me.\n`, 'utf-8');

    // No record ⇒ unverified ⇒ untouched (the marker could be codex's or the user's).
    const noRecord = uninstallTarget(detectInstall('antigravity', 'project'));
    assert.deepEqual(noRecord.removedRules, []);
    assert.ok(fs.readFileSync('AGENTS.md', 'utf-8').includes('weegloo:'));

    // With the record claiming it, it goes — and the user's prose survives.
    writeState('antigravity', { record: { skills: [], rules: ['weegloo-version'] } });
    const withRecord = uninstallTarget(detectInstall('antigravity', 'project'));
    assert.deepEqual(withRecord.removedRules, ['weegloo-version']);
    const body = fs.readFileSync('AGENTS.md', 'utf-8');
    assert.ok(!body.includes('weegloo:'));
    assert.ok(body.includes('Keep me.'));
  });
});

// ── runUninstall ─────────────────────────────────────────────────────────────

test('runUninstall: nothing installed → no-op with guidance, nothing created', async () => {
  await inTmpProject(async () => {
    const lines = [];
    const res = await runUninstall(cfg({ agent: 'claude' }), { log: (s) => lines.push(String(s)) });

    assert.equal(res.status, 'nothing-installed');
    assert.ok(lines.some((l) => l.includes('No weegloo install found')));
    assert.equal(fs.existsSync('.weegloo'), false);
  });
});

test('runUninstall: non-interactive removes the pinned agent + location', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });

    const res = await runUninstall(cfg({ agent: 'claude' }), quiet);

    assert.equal(res.status, 'uninstalled');
    assert.equal(res.reports.length, 1);
    assert.deepEqual(res.reports[0].removedSkills, ['weegloo-script']);
    assert.equal(fs.existsSync('.claude'), false);
  });
});

test('runUninstall: wrong --location points at the scope that DOES have an install', async () => {
  await inTmpProject(async () => {
    await withFakeHome(async () => {
      seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
      const lines = [];

      // scope unpinned in non-interactive mode ⇒ the documented default, global — and the
      // (fake, empty) home has no install, while this project does.
      const res = await runUninstall(cfg({ agent: 'claude', scope: null }), {
        log: (s) => lines.push(String(s)),
      });

      assert.equal(res.status, 'nothing-installed');
      assert.ok(lines.some((l) => l.includes('--location project')), 'hints the right scope');
      assert.equal(
        fs.existsSync(path.join('.claude', 'skills', 'weegloo-script')),
        true,
        'the other scope is never removed on the strength of a hint'
      );
    });
  });
});

test('runUninstall: global scope is detected and removed in the home directory', async () => {
  await withFakeHome(async (home) => {
    writeSkill(path.join(home, '.claude', 'skills'), 'weegloo-script');
    fs.mkdirSync(path.join(home, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'rules', 'weegloo-version.md'), 'body', 'utf-8');
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { weegloo: {}, 'weegloo-upload': {} }, otherState: 1 }),
      'utf-8'
    );
    fs.mkdirSync(path.join(home, '.weegloo', 'claude'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.weegloo', 'claude', 'installed.json'),
      JSON.stringify({ skills: ['weegloo-script'], rules: ['weegloo-version'] }),
      'utf-8'
    );

    const res = await runUninstall(cfg({ agent: 'claude', scope: 'global' }), quiet);

    assert.equal(res.status, 'uninstalled');
    assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
    assert.equal(fs.existsSync(path.join(home, '.weegloo')), false);
    // ~/.claude.json holds the agent's own state — only the weegloo servers come out
    assert.deepEqual(readJson(path.join(home, '.claude.json')), { otherState: 1 });
  });
});

test('runUninstall: interactive confirm declined → nothing is changed', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });

    const res = await runUninstall(cfg({ agent: 'claude', nonInteractive: false }), {
      ...quiet,
      promptCheckbox: async () => ['claude:project'],
      promptConfirm: async () => false,
    });

    assert.equal(res.status, 'cancelled');
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-script')), true);
    assert.equal(fs.existsSync('.mcp.json'), true);
    assert.equal(fs.existsSync('.weegloo'), true);
  });
});

test('runUninstall: interactive selecting nothing is also a no-op', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    let confirmed = false;

    const res = await runUninstall(cfg({ agent: 'claude', nonInteractive: false }), {
      ...quiet,
      promptCheckbox: async () => [],
      promptConfirm: async () => ((confirmed = true), true),
    });

    assert.equal(res.status, 'cancelled');
    assert.equal(confirmed, false, 'never asks to confirm an empty selection');
    assert.equal(fs.existsSync('.weegloo'), true);
  });
});

test('runUninstall: interactive offers the detected install pre-checked and removes it', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    let choices = null;

    const res = await runUninstall(cfg({ agent: 'claude', nonInteractive: false }), {
      ...quiet,
      promptCheckbox: async ({ choices: given }) => {
        choices = given;
        return given.filter((c) => c.checked).map((c) => c.value);
      },
      promptConfirm: async () => true,
    });

    assert.equal(res.status, 'uninstalled');
    assert.deepEqual(choices.map((c) => c.value), ['claude:project']);
    assert.equal(choices[0].checked, true, 'strong evidence ⇒ checked');
    assert.equal(fs.existsSync('.claude'), false);
  });
});

test('runUninstall: re-running after a full uninstall is a clean no-op (idempotent)', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    await runUninstall(cfg({ agent: 'claude' }), quiet);
    const res = await runUninstall(cfg({ agent: 'claude' }), quiet);
    assert.equal(res.status, 'nothing-installed');
  });
});

// ── store map ────────────────────────────────────────────────────────────────

test('getAgentStore: every agent exposes a skills, rules and MCP store per scope', () => {
  for (const agent of ['claude', 'cursor', 'codex', 'antigravity', 'androidstudio']) {
    for (const scope of ['global', 'project']) {
      const store = getAgentStore(agent, scope);
      assert.ok(store, `${agent}/${scope}`);
      assert.ok(store.skills.dir, `${agent}/${scope} skills dir`);
      assert.ok(store.rules.kind === 'files' ? store.rules.dir : store.rules.file);
      assert.ok(store.mcp?.file, `${agent}/${scope} mcp file`);
    }
  }
  assert.equal(getAgentStore('nope', 'global'), null);
});

// ── regression: the user-authored `weegloo-*` false positive ─────────────────
// A repo-authored `weegloo-npm-publish` project skill was deleted by an earlier version:
// the candidate set was record ∪ prefix-scan, `claude (project)` had no record, and the
// confirmation showed only "skills … (1)" — nothing the user could recognize.

test('a user-authored weegloo-* skill is NEVER removed without being picked by name', async () => {
  await inTmpProject(async () => {
    // an MCP-only install (no record) + the user's own weegloo-prefixed project skill
    writeSkill(path.join('.claude', 'skills'), 'weegloo-npm-publish');
    fs.writeFileSync('.mcp.json', JSON.stringify({ mcpServers: { weegloo: {} } }), 'utf-8');

    const detected = detectInstall('claude', 'project');
    assert.deepEqual(detected.skills, [], 'no record ⇒ nothing is removable on its own');
    assert.deepEqual(detected.unverifiedSkills, ['weegloo-npm-publish']);

    const report = uninstallTarget(detected);

    assert.deepEqual(report.removedSkills, []);
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-npm-publish')), true);
    assert.deepEqual(report.mcp.removed, ['weegloo'], 'the MCP entry still goes');
  });
});

test('an unverified id IS removed once the user picks it out by name', async () => {
  await inTmpProject(async () => {
    writeSkill(path.join('.claude', 'skills'), 'weegloo-orphan');

    const detected = detectInstall('claude', 'project');
    const report = uninstallTarget(detected, { extraSkillIds: ['weegloo-orphan'] });

    assert.deepEqual(report.removedSkills, ['weegloo-orphan']);
  });
});

test('extraSkillIds cannot smuggle in an id the target never offered as unverified', async () => {
  await inTmpProject(async () => {
    writeSkill(path.join('.claude', 'skills'), 'my-own-skill');

    const report = uninstallTarget(detectInstall('claude', 'project'), {
      extraSkillIds: ['my-own-skill', '../../escape'],
    });

    assert.deepEqual(report.removedSkills, []);
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'my-own-skill')), true);
  });
});

test('the plan NAMES every item it will delete (a bare count hid the bug)', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    const lines = [];

    await runUninstall(cfg({ agent: 'claude', nonInteractive: false }), {
      log: (s) => lines.push(String(s)),
      promptCheckbox: async ({ choices }) => choices.filter((c) => c.checked).map((c) => c.value),
      promptConfirm: async () => true,
    });

    const plan = lines.join('\n');
    assert.ok(plan.includes('weegloo-script'), 'skill id shown, not just a count');
    assert.ok(plan.includes('weegloo-version'), 'rule id shown, not just a count');
    assert.ok(plan.includes('the file is kept'), 'says the MCP file itself survives');
  });
});

test('runUninstall: unverified items are offered separately, unchecked, after the main confirm', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    writeSkill(path.join('.claude', 'skills'), 'weegloo-mine');
    const asked = [];

    await runUninstall(cfg({ agent: 'claude', nonInteractive: false }), {
      ...quiet,
      promptCheckbox: async ({ message, choices }) => {
        asked.push({ message, choices });
        // the target picker takes its defaults; the unverified picker takes nothing
        return choices.filter((c) => c.checked).map((c) => c.value);
      },
      promptConfirm: async () => true,
    });

    assert.equal(asked.length, 2, 'a second, separate question for the unverified item');
    const unverified = asked[1];
    assert.ok(/Also remove these/.test(unverified.message));
    assert.deepEqual(unverified.choices.map((c) => c.value), ['skill:weegloo-mine']);
    assert.equal(unverified.choices[0].checked, false, 'never pre-checked');
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-mine')), true, 'declined ⇒ kept');
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-script')), false, 'recorded ⇒ removed');
  });
});

test('runUninstall: -y never removes unverified items and names what it left', async () => {
  await inTmpProject(async () => {
    seedClaude({ skills: ['weegloo-script'], rules: ['weegloo-version'] });
    writeSkill(path.join('.claude', 'skills'), 'weegloo-mine');
    const lines = [];

    await runUninstall(cfg({ agent: 'claude' }), { log: (s) => lines.push(String(s)) });

    assert.ok(lines.some((l) => l.includes('weegloo-mine')), 'says what it skipped, by name');
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-mine')), true);
    assert.equal(fs.existsSync(path.join('.claude', 'skills', 'weegloo-script')), false);
  });
});
