import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVersionsIndex } from '../../scripts/build-versions-index.mjs';
import { fetchVersionsIndex } from '../src/github.js';

function withMockedFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = real;
    });
}

test('buildVersionsIndex sorts newest-first and honors the isLatest flag', () => {
  const idx = buildVersionsIndex([
    { tagName: 'v1.0.0', createdAt: '2026-01-01T00:00:00Z', isLatest: false },
    { tagName: 'v1.2.0', createdAt: '2026-03-01T00:00:00Z', isLatest: true },
    { tagName: 'v1.1.0', createdAt: '2026-02-01T00:00:00Z', isLatest: false },
  ]);
  assert.equal(idx.latest, 'v1.2.0');
  assert.deepEqual(
    idx.versions.map((v) => v.version),
    ['v1.2.0', 'v1.1.0', 'v1.0.0']
  );
  assert.equal(idx.schemaVersion, 1);
});

test('buildVersionsIndex skips drafts and prefers newest non-prerelease for latest', () => {
  const idx = buildVersionsIndex([
    { tagName: 'v2.0.0-rc1', createdAt: '2026-04-01T00:00:00Z', isPrerelease: true },
    { tagName: 'v1.9.0', createdAt: '2026-03-01T00:00:00Z' },
    { tagName: 'v9.9.9', createdAt: '2026-05-01T00:00:00Z', isDraft: true },
  ]);
  // draft excluded entirely
  assert.ok(!idx.versions.some((v) => v.version === 'v9.9.9'));
  // no isLatest flag → newest non-prerelease wins
  assert.equal(idx.latest, 'v1.9.0');
  // prerelease still listed, but tagged
  assert.equal(idx.versions.find((v) => v.version === 'v2.0.0-rc1')?.prerelease, true);
});

test('buildVersionsIndex caps to max', () => {
  const releases = Array.from({ length: 80 }, (_, i) => ({
    tagName: `v0.0.${i}`,
    createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
  const idx = buildVersionsIndex(releases, { max: 5 });
  assert.equal(idx.versions.length, 5);
});

test('fetchVersionsIndex reads versions.json from GitHub Pages (no api.github.com)', async () => {
  let apiCalled = false;
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.includes('api.github.com')) {
        apiCalled = true;
        throw new Error('must not use api.github.com');
      }
      if (u.includes('github.io') && u.endsWith('/versions.json')) {
        return {
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            latest: 'v1.2.0',
            versions: [{ version: 'v1.2.0' }, { version: 'v1.1.0' }],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const idx = await fetchVersionsIndex();
      assert.equal(idx.latest, 'v1.2.0');
      assert.deepEqual(
        idx.versions.map((v) => v.version),
        ['v1.2.0', 'v1.1.0']
      );
    }
  );
  assert.equal(apiCalled, false);
});

test('fetchVersionsIndex returns null when the index is unavailable', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 404 }),
    async () => {
      assert.equal(await fetchVersionsIndex(), null);
    }
  );
});
