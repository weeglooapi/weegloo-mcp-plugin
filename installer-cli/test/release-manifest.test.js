import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseAssetUrl, fetchResourceLists } from '../src/github.js';

function withMockedFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = real;
    });
}

test('releaseAssetUrl maps a tag ref to that release', () => {
  assert.equal(
    releaseAssetUrl('v1.0.13', 'manifest.json'),
    'https://github.com/weeglooapi/weegloo-mcp-plugin/releases/download/v1.0.13/manifest.json'
  );
  assert.equal(
    releaseAssetUrl('1.0.13', 'weegloo-bundle.zip'),
    'https://github.com/weeglooapi/weegloo-mcp-plugin/releases/download/1.0.13/weegloo-bundle.zip'
  );
});

test('releaseAssetUrl maps latest / branch / empty to the latest release', () => {
  const latest =
    'https://github.com/weeglooapi/weegloo-mcp-plugin/releases/latest/download/manifest.json';
  assert.equal(releaseAssetUrl('latest', 'manifest.json'), latest);
  assert.equal(releaseAssetUrl('develop', 'manifest.json'), latest);
  assert.equal(releaseAssetUrl('', 'manifest.json'), latest);
});

test('fetchResourceLists reads ids from the release manifest (no api.github.com)', async () => {
  let apiCalled = false;
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.includes('api.github.com')) {
        apiCalled = true;
        throw new Error('Contents API must not be called when a manifest exists');
      }
      // 'latest' is resolved to a concrete tag via the releases/latest redirect.
      if (u.endsWith('/releases/latest')) {
        return {
          ok: false,
          status: 302,
          headers: {
            get: (k) =>
              k.toLowerCase() === 'location'
                ? 'https://github.com/weeglooapi/weegloo-mcp-plugin/releases/tag/v9.9.9'
                : null,
          },
        };
      }
      if (u.includes('/releases/download/v9.9.9/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            repoContentPrefix: 'plugins/weegloo',
            skills: [{ id: 'beta-skill' }, { id: 'alpha-skill' }],
            rules: [{ id: 'beta-rule' }, { id: 'alpha-rule' }],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const r = await fetchResourceLists('latest');
      assert.deepEqual(r.skills, ['alpha-skill', 'beta-skill']); // sorted
      assert.deepEqual(r.rules, ['alpha-rule', 'beta-rule']);
      assert.equal(r.repoContentPrefix, 'plugins/weegloo');
    }
  );
  assert.equal(apiCalled, false);
});

test('fetchResourceLists falls back to the Contents API when no manifest', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      // No release manifest available.
      if (u.includes('/releases/')) return { ok: false, status: 404 };
      // Contents API: nested skills dir, then nested rules dir.
      if (u.includes('/contents/plugins/weegloo/skills')) {
        return { ok: true, json: async () => [{ type: 'dir', name: 'from-api-skill' }] };
      }
      if (u.includes('/contents/plugins/weegloo/rules')) {
        return { ok: true, json: async () => [{ type: 'file', name: 'from-api-rule.mdc' }] };
      }
      return { ok: false, status: 404 };
    },
    async () => {
      const r = await fetchResourceLists('some-feature-branch');
      assert.deepEqual(r.skills, ['from-api-skill']);
      assert.deepEqual(r.rules, ['from-api-rule']);
      assert.equal(r.repoContentPrefix, 'plugins/weegloo');
    }
  );
});
