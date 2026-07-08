import assert from 'node:assert/strict';
import test from 'node:test';

import { cmpVersion, classifyVersion, decideVerdict, bumpVersion, parseNpmTokenFromEnv } from '../scripts/release.mjs';

test('cmpVersion: numeric core comparison, not lexicographic', () => {
  assert.ok(cmpVersion('1.5.5', '1.5.4') > 0);
  assert.ok(cmpVersion('1.5.4', '1.5.5') < 0);
  assert.equal(cmpVersion('1.5.4', '1.5.4'), 0);
  // 10 > 9 numerically (a lexicographic compare would get this wrong)
  assert.ok(cmpVersion('1.0.10', '1.0.9') > 0);
  assert.ok(cmpVersion('2.0.0', '1.99.99') > 0);
  // missing segments default to 0
  assert.equal(cmpVersion('1.5', '1.5.0'), 0);
  assert.ok(cmpVersion('1.5.1', '1.5') > 0);
});

test('classifyVersion: first publish when nothing is published', () => {
  assert.equal(classifyVersion('1.0.0', null), 'first');
  assert.equal(classifyVersion('1.0.0', undefined), 'first');
});

test('classifyVersion: ahead / equal / behind vs the registry', () => {
  assert.equal(classifyVersion('1.5.5', '1.5.4'), 'ahead');
  assert.equal(classifyVersion('1.5.4', '1.5.4'), 'equal');
  assert.equal(classifyVersion('1.5.4', '1.5.5'), 'behind'); // registry ahead — must block
});

test('decideVerdict: any blocker wins over version state', () => {
  assert.equal(decideVerdict({ versionState: 'ahead', blockers: ['no token'] }), 'BLOCKED');
  assert.equal(decideVerdict({ versionState: 'equal', blockers: ['no token'] }), 'BLOCKED');
  assert.equal(decideVerdict({ versionState: 'first', blockers: ['registry ahead'] }), 'BLOCKED');
});

test('decideVerdict: equal → NEEDS_BUMP (human gate 1)', () => {
  assert.equal(decideVerdict({ versionState: 'equal', blockers: [] }), 'NEEDS_BUMP');
  assert.equal(decideVerdict({ versionState: 'equal' }), 'NEEDS_BUMP'); // blockers default []
});

test('decideVerdict: first / ahead with no blockers → READY', () => {
  assert.equal(decideVerdict({ versionState: 'first', blockers: [] }), 'READY');
  assert.equal(decideVerdict({ versionState: 'ahead', blockers: [] }), 'READY');
});

test('bumpVersion: patch/minor/major reset lower segments; unknown → null', () => {
  assert.equal(bumpVersion('1.5.5', 'patch'), '1.5.6');
  assert.equal(bumpVersion('1.5.5', 'minor'), '1.6.0');
  assert.equal(bumpVersion('1.5.5', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.5.5', 'nope'), null);
  // missing segments default to 0 before bumping
  assert.equal(bumpVersion('1.5', 'patch'), '1.5.1');
});

test('parseNpmTokenFromEnv: plain, export prefix, quotes, whitespace', () => {
  assert.equal(parseNpmTokenFromEnv('NPM_TOKEN=abc123'), 'abc123');
  assert.equal(parseNpmTokenFromEnv('export NPM_TOKEN=abc123'), 'abc123');
  assert.equal(parseNpmTokenFromEnv('NPM_TOKEN="abc123"'), 'abc123');
  assert.equal(parseNpmTokenFromEnv("NPM_TOKEN='abc123'"), 'abc123');
  assert.equal(parseNpmTokenFromEnv('  NPM_TOKEN =  abc123  '), 'abc123');
});

test('parseNpmTokenFromEnv: picks the line among others, ignores comments/other vars', () => {
  const text = '# secrets\nOTHER=1\nNPM_TOKEN=tok\nFOO=bar\n';
  assert.equal(parseNpmTokenFromEnv(text), 'tok');
});

test('parseNpmTokenFromEnv: does NOT match a different var ending in NPM_TOKEN', () => {
  assert.equal(parseNpmTokenFromEnv('MY_NPM_TOKEN=nope'), null);
  assert.equal(parseNpmTokenFromEnv('GITHUB_NPM_TOKEN=nope'), null);
});

test('parseNpmTokenFromEnv: absent or empty → null', () => {
  assert.equal(parseNpmTokenFromEnv(''), null);
  assert.equal(parseNpmTokenFromEnv('FOO=bar'), null);
  assert.equal(parseNpmTokenFromEnv('NPM_TOKEN='), null);
  assert.equal(parseNpmTokenFromEnv('NPM_TOKEN=""'), null);
});

test('importing release.mjs does not run the CLI (main is guarded)', () => {
  // If main() had executed on import, the test process would have exited or printed a verdict.
  // Reaching this assertion at all proves the import.meta guard works.
  assert.equal(typeof decideVerdict, 'function');
});
