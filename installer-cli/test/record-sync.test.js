import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeSkillDirs } from '../src/io.js';
import {
  readInstalledRecord,
  writeInstalledRecord,
  writeVersionStamp,
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

// ── readInstalledRecord / writeInstalledRecord (installed.json — separate from the stamp) ─────

test('readInstalledRecord returns the persisted skills/rules lists', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    fs.writeFileSync(rec, JSON.stringify({ skills: ['weegloo-a'], rules: ['weegloo-r1'] }), 'utf-8');
    assert.deepEqual(readInstalledRecord('global', rec), { skills: ['weegloo-a'], rules: ['weegloo-r1'] });
  });
});

test('readInstalledRecord treats a missing/garbled/wrong-typed record as empty lists', () => {
  withTmp('weegloo-record-', (root) => {
    assert.deepEqual(readInstalledRecord('global', path.join(root, 'missing.json')), { skills: [], rules: [] });

    const garbled = path.join(root, 'garbled.json');
    fs.writeFileSync(garbled, '{ not valid json', 'utf-8');
    assert.deepEqual(readInstalledRecord('global', garbled), { skills: [], rules: [] });

    const wrong = path.join(root, 'wrong.json');
    fs.writeFileSync(wrong, JSON.stringify({ skills: 'nope', rules: [1, 'weegloo-ok', null] }), 'utf-8');
    assert.deepEqual(readInstalledRecord('global', wrong), { skills: [], rules: ['weegloo-ok'] });
  });
});

// Backward compatibility: a record file from an older installer (or a partially-written one) may
// exist but have no `skills`/`rules` keys. That must be treated as empty lists, never an error.
test('readInstalledRecord: file present but skills/rules keys absent → empty lists (no throw)', () => {
  withTmp('weegloo-record-', (root) => {
    const emptyObj = path.join(root, 'empty.json');
    fs.writeFileSync(emptyObj, '{}', 'utf-8');
    assert.deepEqual(readInstalledRecord('global', emptyObj), { skills: [], rules: [] });

    // e.g. an old file that only carried unrelated fields — still no skills/rules.
    const fieldless = path.join(root, 'fieldless.json');
    fs.writeFileSync(fieldless, JSON.stringify({ last_check: '2026-01-01' }), 'utf-8');
    assert.deepEqual(readInstalledRecord('global', fieldless), { skills: [], rules: [] });

    // Only one of the two keys present → the other defaults to [].
    const partial = path.join(root, 'partial.json');
    fs.writeFileSync(partial, JSON.stringify({ skills: ['weegloo-a'] }), 'utf-8');
    assert.deepEqual(readInstalledRecord('global', partial), { skills: ['weegloo-a'], rules: [] });
  });
});

test('writeInstalledRecord merges — updating only skills preserves the prior rules list', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    writeInstalledRecord('global', { skills: ['weegloo-a'], rules: ['weegloo-r1'] }, rec);
    assert.deepEqual(readJson(rec), { skills: ['weegloo-a'], rules: ['weegloo-r1'] });

    writeInstalledRecord('global', { skills: ['weegloo-a', 'weegloo-b'] }, rec);
    assert.deepEqual(readJson(rec), { skills: ['weegloo-a', 'weegloo-b'], rules: ['weegloo-r1'] });
  });
});

test('the record is independent of version-check.json — the rule overwriting the stamp cannot wipe it', () => {
  withTmp('weegloo-record-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    writeInstalledRecord('global', { skills: ['weegloo-a'], rules: ['weegloo-r1'] }, rec);

    // Simulate the weegloo-version rule's periodic write: it overwrites version-check.json with
    // ONLY last_check. The record lives in a different file and must be untouched.
    fs.writeFileSync(stamp, JSON.stringify({ last_check: '2026-08-01' }), 'utf-8');

    assert.deepEqual(readInstalledRecord('global', rec), { skills: ['weegloo-a'], rules: ['weegloo-r1'] });
  });
});

// ── syncInstalledRecord ──────────────────────────────────────────────────────

test('syncInstalledRecord: a skill deleted upstream is removed on the next update (the core case)', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    for (const id of ['weegloo-abc', 'weegloo-keep']) fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
    writeInstalledRecord('global', { skills: ['weegloo-abc', 'weegloo-keep'], rules: [] }, rec);

    // New version dropped `weegloo-abc`; the update installs only `weegloo-keep`.
    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      manageSkills: true,
      installedSkillIds: ['weegloo-keep'],
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: [],
    });

    assert.deepEqual(res.removedSkills, ['weegloo-abc']);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-abc')), false, 'deleted-upstream skill gone');
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-keep')), true, 'still-shipped skill kept');
    assert.deepEqual(readInstalledRecord('global', rec), { skills: ['weegloo-keep'], rules: [] });
    // Stamp is armed with ONLY last_check (no record leakage into the rule-owned file).
    assert.deepEqual(readJson(stamp), { last_check: '2026-07-20T12:00:00' });
  });
});

test('syncInstalledRecord: a deselected (still-shipped) skill is also removed — sync-to-install', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    for (const id of ['weegloo-a', 'weegloo-b']) fs.mkdirSync(path.join(skillsDir, id), { recursive: true });
    writeInstalledRecord('global', { skills: ['weegloo-a', 'weegloo-b'], rules: [] }, rec);

    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      manageSkills: true,
      installedSkillIds: ['weegloo-a'], // user deselected weegloo-b this run
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: false,
    });

    assert.deepEqual(res.removedSkills, ['weegloo-b']);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-b')), false);
    assert.deepEqual(readInstalledRecord('global', rec).skills, ['weegloo-a']);
  });
});

test('syncInstalledRecord: an unmanaged kind is left untouched (no removal, prior record preserved)', () => {
  withTmp('weegloo-sync-', (root) => {
    const rec = path.join(root, 'installed.json');
    const stamp = path.join(root, 'version-check.json');
    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'weegloo-a'), { recursive: true });
    writeInstalledRecord('global', { skills: ['weegloo-a'], rules: ['weegloo-r1'] }, rec);

    let removeSkillsCalled = false;
    const res = syncInstalledRecord({
      scope: 'global',
      now: '2026-07-20T12:00:00',
      stampPath: stamp,
      recordPath: rec,
      manageSkills: false, // e.g. --ignore-skill: do not touch skills at all
      installedSkillIds: [],
      removeSkills: () => {
        removeSkillsCalled = true;
        return [];
      },
      manageRules: true,
      installedRuleIds: ['weegloo-r1'],
    });

    assert.equal(removeSkillsCalled, false, 'unmanaged kind: removal callback never invoked');
    assert.deepEqual(res.removedSkills, []);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-a')), true, 'unmanaged skill dir kept');
    assert.deepEqual(readInstalledRecord('global', rec), { skills: ['weegloo-a'], rules: ['weegloo-r1'] });
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
      manageSkills: true,
      installedSkillIds: ['weegloo-a'],
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules: true,
      installedRuleIds: ['weegloo-version'],
    });

    assert.deepEqual(res.removedSkills, [], 'no record yet → nothing pruned on first run');
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-a')), true);
    assert.deepEqual(readInstalledRecord('global', rec), {
      skills: ['weegloo-a'],
      rules: ['weegloo-version'],
    });
  });
});
