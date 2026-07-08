import assert from 'node:assert/strict';
import test from 'node:test';

import { cmpVersion, classifyVersion, decideVerdict } from '../scripts/release.mjs';

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

test('importing release.mjs does not run the CLI (main is guarded)', () => {
  // If main() had executed on import, the test process would have exited or printed a verdict.
  // Reaching this assertion at all proves the import.meta guard works.
  assert.equal(typeof decideVerdict, 'function');
});
