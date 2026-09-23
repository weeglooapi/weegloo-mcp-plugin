import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchCountry, loadResources } from '../src/github.js';

// The network half of the country filter: the lookup (fetchCountry) and the manifest field
// (loadResources → normalizeManifest). Every test swaps globalThis.fetch and restores it in
// `finally`, so nothing here ever reaches the network.

const COUNTRY_ENDPOINT = 'https://ai.weegloo.com/v1/country';

/** Runs `body` with fetch replaced by `impl`; records every call's (url, init). */
async function withFetch(impl, body) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init, calls.length);
  };
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

// ── fetchCountry: fail-open lookup ──────────────────────────────────────────

test('fetchCountry: a 200 { country } answers the code', async () => {
  await withFetch(
    () => json({ country: 'KR' }),
    async (calls) => {
      assert.equal(await fetchCountry(COUNTRY_ENDPOINT), 'KR');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, COUNTRY_ENDPOINT);
    }
  );
});

test('fetchCountry: the code is normalized to upper case', async () => {
  await withFetch(
    () => json({ country: ' kr ' }),
    async () => assert.equal(await fetchCountry(COUNTRY_ENDPOINT), 'KR')
  );
});

test('fetchCountry: an "unknown" placeholder or a non-code is null (no filter), not a country', async () => {
  for (const country of ['XX', 'ZZ', 'KOR', '', 42, null]) {
    await withFetch(
      () => json({ country }),
      async () => assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null, JSON.stringify(country))
    );
  }
  await withFetch(
    () => json({}),
    async () => assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null, 'missing field')
  );
  await withFetch(
    () => json(null),
    async () => assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null, 'JSON null body')
  );
});

test('fetchCountry: a 5xx is retried once, then null', async () => {
  await withFetch(
    () => new Response('boom', { status: 500 }),
    async (calls) => {
      assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null);
      assert.equal(calls.length, 2, 'one retry, then give up');
    }
  );
});

test('fetchCountry: a transient 5xx that recovers on the retry still answers', async () => {
  await withFetch(
    (_url, _init, n) => (n === 1 ? new Response('busy', { status: 503 }) : json({ country: 'US' })),
    async (calls) => {
      assert.equal(await fetchCountry(COUNTRY_ENDPOINT), 'US');
      assert.equal(calls.length, 2);
    }
  );
});

test('fetchCountry: a 404 is null without a retry', async () => {
  await withFetch(
    () => new Response('not found', { status: 404 }),
    async (calls) => {
      assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null);
      assert.equal(calls.length, 1);
    }
  );
});

test('fetchCountry: a non-JSON body is null (never throws)', async () => {
  await withFetch(
    () => new Response('<!doctype html><div id="root"></div>', { status: 200 }),
    async () => assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null)
  );
});

test('fetchCountry: a network error is null after the retry (never throws)', async () => {
  await withFetch(
    () => {
      throw new TypeError('fetch failed');
    },
    async (calls) => {
      assert.equal(await fetchCountry(COUNTRY_ENDPOINT), null);
      assert.equal(calls.length, 2);
    }
  );
});

test('fetchCountry: a stalled connection times out to null (the per-attempt deadline applies)', async () => {
  // Settles only when aborted — what a hung socket looks like to fetch.
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  await withFetch(hang, async (calls) => {
    assert.equal(await fetchCountry(COUNTRY_ENDPOINT, { timeout: 20 }), null);
    assert.equal(calls.length, 2, 'each attempt was aborted at its deadline');
  });
});

test('fetchCountry: the request sends no headers — in particular no Accept', async () => {
  await withFetch(
    () => json({ country: 'KR' }),
    async (calls) => {
      await fetchCountry(COUNTRY_ENDPOINT);
      const { init } = calls[0];
      assert.ok(init && init.signal, 'only the abort signal is passed');
      assert.equal(init.headers, undefined);
      assert.ok(!Object.keys(init).some((k) => k.toLowerCase() === 'headers'));
    }
  );
});

// ── loadResources: the manifest's optional `country` field ───────────────────

function manifestWith({ skillCountry, ruleCountry } = {}) {
  return {
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: { weeglooUrl: 'https://ai.weegloo.com/mcp', uploadApiUrl: 'https://upload.weegloo.com/v1' },
    skills: [
      { id: 'kr-only', ...(skillCountry !== undefined ? { country: skillCountry } : {}), files: { 'SKILL.md': 'x' } },
      { id: 'everywhere', files: { 'SKILL.md': 'y' } },
    ],
    rules: [
      { id: 'not-kr', ...(ruleCountry !== undefined ? { country: ruleCountry } : {}), content: 'body' },
      { id: 'plain', content: 'body2' },
    ],
  };
}

const serveManifest = (manifest) => (url) =>
  String(url).includes('installer-manifest.json') ? json(manifest) : new Response('x', { status: 404 });

test('loadResources: a valid country spec is carried through on skills and rules', async () => {
  const manifest = manifestWith({ skillCountry: { include: ['KR'] }, ruleCountry: { exclude: ['KR', 'US'] } });
  await withFetch(serveManifest(manifest), async () => {
    const r = await loadResources('latest');
    assert.deepEqual(r.skills, [
      { id: 'kr-only', country: { include: ['KR'] }, files: { 'SKILL.md': 'x' } },
      { id: 'everywhere', files: { 'SKILL.md': 'y' } },
    ]);
    assert.deepEqual(r.rules, [
      { id: 'not-kr', country: { exclude: ['KR', 'US'] }, content: 'body' },
      { id: 'plain', content: 'body2' },
    ]);
  });
});

test('loadResources: an untagged entry gets NO country key (the pre-feature shape, exactly)', async () => {
  await withFetch(serveManifest(manifestWith()), async () => {
    const r = await loadResources('latest');
    for (const entry of [...r.skills, ...r.rules]) {
      assert.ok(!('country' in entry), `${entry.id} has no country key`);
    }
  });
});

test('loadResources: a malformed country rejects the whole manifest (strict — no silent install-everywhere)', async () => {
  // null is included on purpose: the builder never emits it (unrestricted = key absent).
  const malformed = [{ include: [] }, { include: ['kr'] }, 'KR', ['KR'], { include: ['KR'], exclude: ['US'] }, { only: ['KR'] }, null];
  for (const bad of malformed) {
    await withFetch(serveManifest(manifestWith({ skillCountry: bad })), async () => {
      assert.equal(await loadResources('latest'), null, `skill country ${JSON.stringify(bad)}`);
    });
    await withFetch(serveManifest(manifestWith({ ruleCountry: bad })), async () => {
      assert.equal(await loadResources('latest'), null, `rule country ${JSON.stringify(bad)}`);
    });
  }
});
