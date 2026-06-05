import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchReleaseVersions } from '../src/github.js';

function withMockedFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = real;
    });
}

const atom = (tags) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">` +
  tags
    .map(
      (t) =>
        `<entry><id>tag:github.com,2008:Repository/1/${t}</id>` +
        `<link rel="alternate" type="text/html" href="https://github.com/weeglooapi/weegloo-mcp-plugin/releases/tag/${t}"/></entry>`
    )
    .join('') +
  `</feed>`;

test('fetchReleaseVersions parses release tags newest-first from releases.atom (no api.github.com)', async () => {
  let apiCalled = false;
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.includes('api.github.com')) {
        apiCalled = true;
        throw new Error('must not use api.github.com');
      }
      if (u.endsWith('/releases.atom')) {
        return { ok: true, text: async () => atom(['v1.0.13', 'v1.0.12', 'v1.0.11']) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const versions = await fetchReleaseVersions();
      assert.deepEqual(versions, ['v1.0.13', 'v1.0.12', 'v1.0.11']);
    }
  );
  assert.equal(apiCalled, false);
});

test('fetchReleaseVersions dedupes repeated tag links within an entry', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).endsWith('/releases.atom')) {
        // Same tag referenced twice (e.g. <id> + <link>).
        return {
          ok: true,
          text: async () =>
            `<feed><entry>` +
            `<link href="https://github.com/x/y/releases/tag/v2.0.0"/>` +
            `<content>https://github.com/x/y/releases/tag/v2.0.0</content>` +
            `</entry><entry><link href="https://github.com/x/y/releases/tag/v1.0.0"/></entry></feed>`,
        };
      }
      throw new Error('unexpected');
    },
    async () => {
      assert.deepEqual(await fetchReleaseVersions(), ['v2.0.0', 'v1.0.0']);
    }
  );
});

test('fetchReleaseVersions falls back to tags.atom when releases.atom is empty/missing', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.endsWith('/releases.atom')) return { ok: false, status: 404 };
      if (u.endsWith('/tags.atom')) return { ok: true, text: async () => atom(['v0.9.0']) };
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      assert.deepEqual(await fetchReleaseVersions(), ['v0.9.0']);
    }
  );
});

test('fetchReleaseVersions returns [] when both feeds fail', async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      assert.deepEqual(await fetchReleaseVersions(), []);
    }
  );
});
