import assert from 'node:assert/strict';
import test from 'node:test';

import { orderBranchesForPicker, sortVersionBranches, isSemverBranch } from '../src/versions.js';

test('isSemverBranch: strict MAJOR.MINOR.PATCH only', () => {
  for (const ok of ['1.0.10', 'v1.0.0', '2.3.4', '1.0.0-beta.1', '1.0.0+build.5']) {
    assert.ok(isSemverBranch(ok), `expected semver: ${ok}`);
  }
  for (const no of ['1.0', '1', 'latest', 'develop', 'feat/x', 'beta', '1.0.x', 'v1']) {
    assert.ok(!isSemverBranch(no), `expected NOT semver: ${no}`);
  }
});

test('sortVersionBranches: semver only, newest-first, capped — no latest/develop awareness', () => {
  const input = ['1.0.9', 'beta', '1.0.12', 'latest', '1.0.10', 'develop'];
  assert.deepEqual(sortVersionBranches(input, { limit: 2 }), ['1.0.12', '1.0.10']);
  assert.deepEqual(sortVersionBranches(['main', 'develop', 'latest']), []); // no semver
});

test('orderBranchesForPicker (default): latest first, newest N semver, everything else dropped', () => {
  const input = ['1.0.9', 'beta', '1.0.12', 'latest', '1.0.10', '1.0.11', '1.0.8', '1.0.7', 'develop', 'feat/x'];
  const out = orderBranchesForPicker(input, { limit: 5 });
  assert.deepEqual(out, ['latest', '1.0.12', '1.0.11', '1.0.10', '1.0.9', '1.0.8']);
});

test('orderBranchesForPicker (showAll): latest first → versions → others alpha → develop LAST', () => {
  const input = ['1.0.12', 'latest', 'develop', 'feat/x', 'beta'];
  const out = orderBranchesForPicker(input, { showAll: true });
  assert.deepEqual(out, ['latest', '1.0.12', 'beta', 'feat/x', 'develop']);
});

test('orderBranchesForPicker: pinned branches appear only when present', () => {
  // no `latest`, no `develop` in input
  const out = orderBranchesForPicker(['1.0.2', '1.0.1', 'beta'], { showAll: true });
  assert.deepEqual(out, ['1.0.2', '1.0.1', 'beta']);
});

test('orderBranchesForPicker: no latest/semver (default) → empty (picker is skipped)', () => {
  assert.deepEqual(orderBranchesForPicker(['main', 'beta', 'develop']), []);
});
