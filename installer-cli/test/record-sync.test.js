import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeSkillDirs } from '../src/io.js';
import {
  readInstalledRecord,
  writeInstalledRecord,
  getInstalledRecordPath,
  getLegacyInstalledRecordPath,
  syncInstalledRecord,
} from '../src/self-update.js';

function withTmp(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

/** Full record shape with the catalog keys defaulted — keeps expectations readable. */
const record = ({ skills = [], rules = [], availableSkills = [], availableRules = [] } = {}) => ({
  skills,
  rules,
  availableSkills,
  availableRules,
});

// ── record paths (per-agent, plus the read-only legacy flat path) ─────────────

test('record path is per-agent; legacy flat path is a sibling (never written anymore)', () => {
  assert.equal(
    getInstalledRecordPath('global', 'claude'),
    path.join(os.homedir(), '.weegloo', 'claude', 'installed.json')
  );
  assert.equal(
    getInstalledRecordPath('project', 'codex', '/proj'),
    path.join('/proj', '.weegloo', 'codex', 'installed.json')
  );
  assert.equal(
    getLegacyInstalledRecordPath('global'),
    path.join(os.homedir(), '.weegloo', 'installed.json')
  );
  assert.equal(
    getLegacyInstalledRecordPath('project', '/proj'),
    path.join('/proj', '.weegloo', 'installed.json')
  );
});

// ── readInstalledRecord / writeInstalledRecord (installed.json — separate from the stamp) ─────

test('readInstalledRecord returns the persisted selection + offered catalog', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    fs.writeFileSync(
      rec,
      JSON.stringify({
        skills: ['weegloo-a'],
        rules: ['weegloo-r1'],
        availableSkills: ['weegloo-a', 'weegloo-b'],
        availableRules: ['weegloo-r1', 'weegloo-r2'],
      }),
      'utf-8'
    );
    assert.deepEqual(
      readInstalledRecord(rec),
      record({
        skills: ['weegloo-a'],
        rules: ['weegloo-r1'],
        availableSkills: ['weegloo-a', 'weegloo-b'],
        availableRules: ['weegloo-r1', 'weegloo-r2'],
      })
    );
  });
});

test('readInstalledRecord treats a missing/garbled/wrong-typed record as empty lists', () => {
  withTmp('weegloo-record-', (root) => {
    assert.deepEqual(readInstalledRecord(path.join(root, 'missing.json')), record());

    const garbled = path.join(root, 'garbled.json');
    fs.writeFileSync(garbled, '{ not valid json', 'utf-8');
    assert.deepEqual(readInstalledRecord(garbled), record());

    const wrong = path.join(root, 'wrong.json');
    fs.writeFileSync(wrong, JSON.stringify({ skills: 'nope', rules: [1, 'weegloo-ok', null] }), 'utf-8');
    assert.deepEqual(readInstalledRecord(wrong), record({ rules: ['weegloo-ok'] }));
  });
});

// Backward compatibility: a legacy record (pre-catalog) has only skills/rules — the catalog keys
// must default to empty lists, never an error. That empty catalog is exactly what the update flow
// reads as "unknown offering" (→ no auto-add, no catalog-verified removal on the first cycle).
test('readInstalledRecord: legacy record without catalog keys → catalog defaults to empty (no throw)', () => {
  withTmp('weegloo-record-', (root) => {
    const emptyObj = path.join(root, 'empty.json');
    fs.writeFileSync(emptyObj, '{}', 'utf-8');
    assert.deepEqual(readInstalledRecord(emptyObj), record());

    // e.g. an old file that only carried unrelated fields — still no skills/rules.
    const fieldless = path.join(root, 'fieldless.json');
    fs.writeFileSync(fieldless, JSON.stringify({ last_check: '2026-01-01' }), 'utf-8');
    assert.deepEqual(readInstalledRecord(fieldless), record());

    // Only some keys present → the others default to [].
    const partial = path.join(root, 'partial.json');
    fs.writeFileSync(partial, JSON.stringify({ skills: ['weegloo-a'] }), 'utf-8');
    assert.deepEqual(readInstalledRecord(partial), record({ skills: ['weegloo-a'] }));
  });
});

test('writeInstalledRecord merges — updating only skills preserves the prior rules list', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    writeInstalledRecord(rec, { skills: ['weegloo-a'], rules: ['weegloo-r1'] });
    assert.deepEqual(readJson(rec), { skills: ['weegloo-a'], rules: ['weegloo-r1'] });

    writeInstalledRecord(rec, { skills: ['weegloo-a', 'weegloo-b'] });
    assert.deepEqual(readJson(rec), { skills: ['weegloo-a', 'weegloo-b'], rules: ['weegloo-r1'] });
  });
});

test('the record is independent of version-check.json — the rule overwriting the stamp cannot wipe it', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    writeInstalledRecord(rec, { skills: ['weegloo-a'], rules: ['weegloo-r1'] });

    // Simulate the weegloo-version rule's periodic write: it overwrites version-check.json with
    // ONLY last_check. The record lives in a different file and must be untouched.
    fs.writeFileSync(stamp, JSON.stringify({ last_check: '2026-08-01' }), 'utf-8');

    assert.deepEqual(readInstalledRecord(rec), record({ skills: ['weegloo-a'], rules: ['weegloo-r1'] }));
  });
});

// ── syncInstalledRecord ──────────────────────────────────────────────────────

test('syncInstalledRecord: a skill deleted upstream is removed on the next update (the core case)', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    for (const id of ['weegloo-abc', 'weegloo-keep']) fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
    writeInstalledRecord(rec, { skills: ['weegloo-abc', 'weegloo-keep'], rules: [] });

    // New version dropped `weegloo-abc`; the update installs only `weegloo-keep`.
    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      manageSkills: true,
      installedSkillIds: ['weegloo-keep'],
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: [],
    });

    assert.deepEqual(res.removedSkills, ['weegloo-abc']);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-abc')), false, 'deleted-upstream skill gone');
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-keep')), true, 'still-shipped skill kept');
    assert.deepEqual(readInstalledRecord(rec), record({ skills: ['weegloo-keep'] }));
    // Stamp is armed with ONLY the check state (no record leakage into the rule-owned file).
    assert.deepEqual(readJson(stamp), { last_check: '2026-07-20T12:00:00' });
  });
});

test('syncInstalledRecord: a deselected (still-shipped) skill is also removed — sync-to-install', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    for (const id of ['weegloo-a', 'weegloo-b']) fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
    writeInstalledRecord(rec, { skills: ['weegloo-a', 'weegloo-b'], rules: [] });

    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      manageSkills: true,
      installedSkillIds: ['weegloo-a'], // user deselected weegloo-b this run
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: false,
    });

    assert.deepEqual(res.removedSkills, ['weegloo-b']);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-b')), false);
    assert.deepEqual(readInstalledRecord(rec).skills, ['weegloo-a']);
  });
});

test('syncInstalledRecord: an unmanaged kind is left untouched (no removal, prior record preserved)', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'weegloo-a'), { recursive: true });
    writeInstalledRecord(rec, {
      skills: ['weegloo-a'],
      rules: ['weegloo-r1'],
      availableSkills: ['weegloo-a', 'weegloo-x'],
    });

    let removeSkillsCalled = false;
    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      manageSkills: false, // e.g. --ignore-skill: do not touch skills at all
      installedSkillIds: [],
      removeSkills: () => {
        removeSkillsCalled = true;
        return [];
      },
      manageRules: true,
      installedRuleIds: ['weegloo-r1'],
      availableRuleIds: ['weegloo-r1', 'weegloo-r2'],
    });

    assert.equal(removeSkillsCalled, false, 'unmanaged kind: removal callback never invoked');
    assert.deepEqual(res.removedSkills, []);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-a')), true, 'unmanaged skill dir kept');
    assert.deepEqual(
      readInstalledRecord(rec),
      record({
        skills: ['weegloo-a'],
        rules: ['weegloo-r1'],
        availableSkills: ['weegloo-a', 'weegloo-x'], // unmanaged kind's catalog preserved too
        availableRules: ['weegloo-r1', 'weegloo-r2'],
      })
    );
  });
});

test('syncInstalledRecord: first run against no record removes nothing and seeds the record', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json'); // does not exist yet
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'weegloo-a'), { recursive: true });

    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      manageSkills: true,
      installedSkillIds: ['weegloo-a'],
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: ['weegloo-version'],
    });

    assert.deepEqual(res.removedSkills, [], 'no record yet → nothing pruned on first run');
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-a')), true);
    assert.deepEqual(
      readInstalledRecord(rec),
      record({ skills: ['weegloo-a'], rules: ['weegloo-version'] })
    );
  });
});

test('syncInstalledRecord: stamps the installed version + branch ref for the rule to compare', () => {
  withTmp('weegloo-sync-', (root) => {
    const stamp = path.join(root, 'version-check.json');
    syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: path.join(root, 'installed.json'),
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      version: 'abc123',
      ref: 'develop',
      manageSkills: true,
      installedSkillIds: [],
      manageRules: true,
      installedRuleIds: [],
    });
    assert.deepEqual(readJson(stamp), {
      last_check: '2026-07-20T12:00:00',
      version: 'abc123',
      ref: 'develop',
    });
  });
});

test('syncInstalledRecord: records the offered catalog alongside the selection', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: path.join(root, 'version-check.json'),
      recordPath: rec,
      legacyRecordPath: path.join(root, 'no-legacy.json'),
      manageSkills: true,
      installedSkillIds: ['weegloo-a'], // user picked 1 of 2
      availableSkillIds: ['weegloo-a', 'weegloo-b'],
      manageRules: true,
      installedRuleIds: ['weegloo-version'],
      availableRuleIds: ['weegloo-version', 'weegloo-r2'],
    });
    assert.deepEqual(
      readInstalledRecord(rec),
      record({
        skills: ['weegloo-a'],
        rules: ['weegloo-version'],
        availableSkills: ['weegloo-a', 'weegloo-b'],
        availableRules: ['weegloo-version', 'weegloo-r2'],
      })
    );
  });
});

// Migration: an agent's FIRST per-agent run must still prune what the LEGACY flat record says was
// installed but is gone from this run — otherwise upstream-deleted skills survive as orphans that
// keep loading stale guidance. Foreign (other-agent) ids in the legacy record are harmless: the
// removal callback is existence-checked inside THIS agent's own directories.
test('syncInstalledRecord: no per-agent record yet → falls back to the legacy flat record for pruning', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'agent', 'installed.json'); // per-agent — does not exist yet
    const legacy = path.join(root, 'installed.json'); // flat, shared by all agents pre-split
    const skillsDir = path.join(root, 'skills');
    for (const id of ['weegloo-gone', 'weegloo-keep']) fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
    // Legacy record: this agent had gone+keep; another agent's id is mixed in (shared file).
    fs.writeFileSync(
      legacy,
      JSON.stringify({ skills: ['weegloo-gone', 'weegloo-keep', 'weegloo-other-agents'], rules: [] }),
      'utf-8'
    );

    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: path.join(root, 'agent', 'version-check.json'),
      recordPath: rec,
      legacyRecordPath: legacy,
      manageSkills: true,
      installedSkillIds: ['weegloo-keep'], // upstream dropped weegloo-gone
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: [],
    });

    assert.deepEqual(res.removedSkills, ['weegloo-gone'], 'legacy prev pruned; foreign id was a no-op');
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-gone')), false);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-keep')), true);
    // The per-agent record is seeded; the legacy file is left byte-identical for other agents'
    // own first migrations.
    assert.deepEqual(readInstalledRecord(rec).skills, ['weegloo-keep']);
    assert.deepEqual(readJson(legacy).skills, ['weegloo-gone', 'weegloo-keep', 'weegloo-other-agents']);
  });
});

test('syncInstalledRecord: once a per-agent record exists, the legacy record is ignored', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'agent', 'installed.json');
    const legacy = path.join(root, 'installed.json');
    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'weegloo-mine'), { recursive: true });
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    fs.writeFileSync(rec, JSON.stringify({ skills: ['weegloo-mine'], rules: [] }), 'utf-8');
    // Legacy claims a stale id — must NOT drive removal once the per-agent record exists.
    fs.writeFileSync(legacy, JSON.stringify({ skills: ['weegloo-mine', 'weegloo-stale'], rules: [] }), 'utf-8');

    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: path.join(root, 'agent', 'version-check.json'),
      recordPath: rec,
      legacyRecordPath: legacy,
      manageSkills: true,
      installedSkillIds: ['weegloo-mine'],
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: [],
    });

    assert.deepEqual(res.removedSkills, [], 'per-agent record wins; legacy no longer consulted');
  });
});
