import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCurrentVersion, VERSION_URL } from '../src/github.js';

test('loadCurrentVersion returns the version string from the endpoint', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url) === VERSION_URL
      ? new Response(JSON.stringify({ version: '12' }), { status: 200 })
      : new Response('nope', { status: 404 });
  try {
    assert.equal(await loadCurrentVersion(), '12');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadCurrentVersion coerces a numeric version to a string', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ version: 12 }), { status: 200 });
  try {
    assert.equal(await loadCurrentVersion(), '12');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadCurrentVersion returns null on non-200 / bad JSON / missing field / network error', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x', { status: 500 });
    assert.equal(await loadCurrentVersion(), null, 'non-200');

    globalThis.fetch = async () => new Response('{ not json', { status: 200 });
    assert.equal(await loadCurrentVersion(), null, 'bad json');

    globalThis.fetch = async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 });
    assert.equal(await loadCurrentVersion(), null, 'missing field');

    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    assert.equal(await loadCurrentVersion(), null, 'network error');
  } finally {
    globalThis.fetch = realFetch;
  }
});
