import assert from 'node:assert/strict';
import test from 'node:test';

import { orderBranchesForPicker } from '../src/versions.js';

test('orderBranchesForPicker: latest first, newest N versions desc, then rest alpha', () => {
  const input = ['1.0.9', 'beta', '1.0.12', 'latest', '1.0.10', '1.0.11', '1.0.8', '1.0.7', 'alpha'];
  const out = orderBranchesForPicker(input, { limit: 5 });

  assert.equal(out[0], 'latest');
  assert.deepEqual(out.slice(1, 6), ['1.0.12', '1.0.11', '1.0.10', '1.0.9', '1.0.8']); // newest 5
  assert.deepEqual(out.slice(6), ['alpha', 'beta']); // non-version, alpha
});

test('orderBranchesForPicker: limit caps the version branches shown', () => {
  const out = orderBranchesForPicker(['1.0.1', '1.0.2', '1.0.3'], { limit: 2 });
  assert.deepEqual(out, ['1.0.3', '1.0.2']);
});

test('orderBranchesForPicker: no latest, no versions → alpha-sorted rest', () => {
  assert.deepEqual(orderBranchesForPicker(['main', 'beta', 'alpha']), ['alpha', 'beta', 'main']);
});
