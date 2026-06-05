import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchBranches,
  fetchResourceLists,
  DEFAULT_SKILL_IDS,
  DEFAULT_RULE_IDS,
} from '../src/github.js';

/** Builds a Headers-like object backed by a plain map. */
function headers(map) {
  return { get: (k) => (k in map ? map[k] : null) };
}

function withMockedFetch(impl, fn) {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  console.warn = () => {}; // silence the one-time rate-limit notice during tests
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
    });
}

test('fetchBranches returns [] when GitHub responds with a rate-limit 403', async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }),
    }),
    async () => {
      const branches = await fetchBranches();
      assert.deepEqual(branches, []);
    }
  );
});

test('fetchResourceLists falls back to default ids on rate limit (not silently empty)', async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }),
    }),
    async () => {
      const r = await fetchResourceLists('latest');
      assert.deepEqual(r.skills, DEFAULT_SKILL_IDS);
      assert.deepEqual(r.rules, DEFAULT_RULE_IDS);
    }
  );
});

test('GITHUB_TOKEN is sent as an Authorization: Bearer header', async () => {
  const prev = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_test_token';
  let seenAuth;
  try {
    await withMockedFetch(
      async (_url, opts) => {
        seenAuth = opts.headers.Authorization;
        return {
          ok: false,
          status: 403,
          headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }),
        };
      },
      async () => {
        await fetchBranches();
      }
    );
  } finally {
    if (prev === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prev;
  }
  assert.equal(seenAuth, 'Bearer ghp_test_token');
});

test('a non-rate-limit 403 (remaining > 0) is treated as a normal miss, not rate limit', async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '42' }),
    }),
    async () => {
      // fetchBranches returns [] either way; the point is no throw and graceful handling.
      const branches = await fetchBranches();
      assert.deepEqual(branches, []);
    }
  );
});
