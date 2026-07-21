import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeSkillDirs, removeRuleFiles } from '../src/io.js';
import { upsertRuleInAgentsMd, removeRuleMarkers } from '../src/codex.js';

/** Makes a temp dir, runs fn(dir), always cleans up. */
function withTmp(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeSkill(skillsDir, id) {
  const dir = path.join(skillsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${id}\n`, 'utf-8');
}

// ── removeSkillDirs ──────────────────────────────────────────────────────────

test('removeSkillDirs removes exactly the listed skill dirs and returns their ids', () => {
  withTmp('weegloo-rm-skills-', (root) => {
    const skillsDir = path.join(root, 'skills');
    makeSkill(skillsDir, 'weegloo-old');
    makeSkill(skillsDir, 'weegloo-keep');
    makeSkill(skillsDir, 'my-own-skill'); // a user skill — must never be listed/removed

    const removed = removeSkillDirs(skillsDir, ['weegloo-old']);

    assert.deepEqual(removed, ['weegloo-old']);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-old')), false);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-keep')), true);
    assert.equal(fs.existsSync(path.join(skillsDir, 'my-own-skill')), true, 'user skill untouched');
  });
});

test('removeSkillDirs skips ids that do not exist on disk (no throw, not reported)', () => {
  withTmp('weegloo-rm-skills-', (root) => {
    const skillsDir = path.join(root, 'skills');
    makeSkill(skillsDir, 'weegloo-keep');
    const removed = removeSkillDirs(skillsDir, ['weegloo-ghost', 'weegloo-keep']);
    assert.deepEqual(removed, ['weegloo-keep']);
  });
});

test('removeSkillDirs is a no-op on an empty id list or a missing skills dir', () => {
  withTmp('weegloo-rm-skills-', (root) => {
    const skillsDir = path.join(root, 'skills');
    makeSkill(skillsDir, 'weegloo-keep');
    assert.deepEqual(removeSkillDirs(skillsDir, []), []);
    assert.deepEqual(removeSkillDirs(path.join(root, 'does-not-exist'), ['weegloo-keep']), []);
    assert.equal(fs.existsSync(path.join(skillsDir, 'weegloo-keep')), true);
  });
});

test('removeSkillDirs rejects path-traversal ids (SAFE_ID guard) and never escapes the dir', () => {
  withTmp('weegloo-rm-skills-', (root) => {
    const skillsDir = path.join(root, 'skills');
    makeSkill(skillsDir, 'weegloo-keep');
    const victim = path.join(root, 'victim');
    fs.mkdirSync(victim, { recursive: true });

    const removed = removeSkillDirs(skillsDir, ['../victim', '..\\victim', 'a/b', '']);

    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(victim), true, 'sibling dir outside skillsDir must survive');
  });
});

// ── removeRuleFiles ──────────────────────────────────────────────────────────

test('removeRuleFiles removes <id>.<ext> for the listed ids only', () => {
  withTmp('weegloo-rm-rules-', (root) => {
    const rulesDir = path.join(root, 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    for (const f of ['weegloo-old.md', 'weegloo-keep.md', 'user-rule.md', 'weegloo-old.mdc']) {
      fs.writeFileSync(path.join(rulesDir, f), 'x', 'utf-8');
    }

    const removed = removeRuleFiles(rulesDir, ['weegloo-old', 'weegloo-ghost'], 'md');

    assert.deepEqual(removed, ['weegloo-old']);
    assert.equal(fs.existsSync(path.join(rulesDir, 'weegloo-old.md')), false);
    assert.equal(fs.existsSync(path.join(rulesDir, 'weegloo-old.mdc')), true, 'other extension untouched');
    assert.equal(fs.existsSync(path.join(rulesDir, 'weegloo-keep.md')), true);
    assert.equal(fs.existsSync(path.join(rulesDir, 'user-rule.md')), true, 'user rule untouched');
  });
});

test('removeRuleFiles accepts the extension with or without a leading dot', () => {
  withTmp('weegloo-rm-rules-', (root) => {
    const rulesDir = path.join(root, 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'weegloo-a.mdc'), 'x', 'utf-8');
    fs.writeFileSync(path.join(rulesDir, 'weegloo-b.mdc'), 'x', 'utf-8');

    assert.deepEqual(removeRuleFiles(rulesDir, ['weegloo-a'], '.mdc'), ['weegloo-a']);
    assert.deepEqual(removeRuleFiles(rulesDir, ['weegloo-b'], 'mdc'), ['weegloo-b']);
  });
});

test('removeRuleFiles is a no-op on empty ids / missing dir / traversal ids', () => {
  withTmp('weegloo-rm-rules-', (root) => {
    const rulesDir = path.join(root, 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'weegloo-keep.md'), 'x', 'utf-8');
    assert.deepEqual(removeRuleFiles(rulesDir, [], 'md'), []);
    assert.deepEqual(removeRuleFiles(path.join(root, 'nope'), ['weegloo-keep'], 'md'), []);
    assert.deepEqual(removeRuleFiles(rulesDir, ['../../etc/passwd'], 'md'), []);
    assert.equal(fs.existsSync(path.join(rulesDir, 'weegloo-keep.md')), true);
  });
});

// ── removeRuleMarkers (marker-embedded rules: Codex / Antigravity / Android Studio) ──

test('removeRuleMarkers cuts only the listed sections, keeping prose, other sections, and one BOM', () => {
  withTmp('weegloo-rm-markers-', (root) => {
    const md = path.join(root, 'AGENTS.md');
    fs.writeFileSync(md, '# My project guidance\n\nKeep this prose.\n', 'utf-8');
    upsertRuleInAgentsMd(md, 'weegloo-alpha', 'Alpha rule body');
    upsertRuleInAgentsMd(md, 'weegloo-beta', 'Beta rule body');

    const removed = removeRuleMarkers(md, ['weegloo-alpha', 'weegloo-ghost']);
    assert.deepEqual(removed, ['weegloo-alpha']);

    const bytes = fs.readFileSync(md);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'leading UTF-8 BOM preserved');
    const bomCount = bytes.filter((b, i) => b === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf).length;
    assert.equal(bomCount, 1, 'exactly one BOM');

    const text = bytes.subarray(3).toString('utf-8');
    assert.match(text, /Keep this prose\./, 'hand-written prose survives');
    assert.doesNotMatch(text, /weegloo:weegloo-alpha/, 'removed section markers gone');
    assert.doesNotMatch(text, /Alpha rule body/, 'removed section body gone');
    assert.match(text, /<!-- weegloo:weegloo-beta -->/, 'other section kept');
    assert.match(text, /Beta rule body/);
  });
});

test('removeRuleMarkers is a no-op (returns []) on empty ids, a missing file, or no match', () => {
  withTmp('weegloo-rm-markers-', (root) => {
    const md = path.join(root, 'AGENTS.md');
    upsertRuleInAgentsMd(md, 'weegloo-alpha', 'Alpha');
    const before = fs.readFileSync(md);

    assert.deepEqual(removeRuleMarkers(md, []), []);
    assert.deepEqual(removeRuleMarkers(path.join(root, 'missing.md'), ['weegloo-alpha']), []);
    assert.deepEqual(removeRuleMarkers(md, ['weegloo-ghost']), []);
    assert.deepEqual(fs.readFileSync(md), before, 'file byte-identical when nothing matched');
  });
});
