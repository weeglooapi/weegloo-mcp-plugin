import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';

import { prepareResourceSource } from '../src/resources.js';

function withMockedFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = real;
    });
}

const sampleZip = zipSync({
  'skills/demo-skill/SKILL.md': strToU8('# demo skill\n'),
  'skills/demo-skill/metadata.json': strToU8('{"name":"demo"}'),
  'rules/demo-rule.mdc': strToU8('rule body\n'),
  'manifest.json': strToU8('{}'),
});

test('bundle source serves skill/rule content from the zip (one fetch, no raw)', async () => {
  let rawCalled = false;
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.includes('raw.githubusercontent.com')) {
        rawCalled = true;
        throw new Error('raw must not be hit in bundle mode');
      }
      if (u.includes('/releases/') && u.endsWith('weegloo-bundle.zip')) {
        return { ok: true, arrayBuffer: async () => sampleZip.slice().buffer };
      }
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const src = await prepareResourceSource({ ref: 'v1.0.0', repoContentPrefix: 'plugins/weegloo' });
      assert.equal(src.mode, 'bundle');
      assert.equal(await src.getSkillFile('demo-skill', 'SKILL.md'), '# demo skill\n');
      assert.equal(await src.getSkillFile('demo-skill', 'metadata.json'), '{"name":"demo"}');
      assert.equal(await src.getRuleText('demo-rule'), 'rule body\n');
    }
  );
  assert.equal(rawCalled, false);
});

test('bundle source throws a clear error for a missing entry', async () => {
  await withMockedFetch(
    async (url) => {
      if (String(url).endsWith('weegloo-bundle.zip')) {
        return { ok: true, arrayBuffer: async () => sampleZip.slice().buffer };
      }
      throw new Error('unexpected');
    },
    async () => {
      const src = await prepareResourceSource({ ref: 'v1.0.0', repoContentPrefix: 'plugins/weegloo' });
      await assert.rejects(() => src.getSkillFile('nope', 'SKILL.md'), /missing "skills\/nope\/SKILL\.md"/);
    }
  );
});

test('falls back to remote (raw) source when no bundle exists for the ref', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.includes('/releases/')) return { ok: false, status: 404 };
      if (u.includes('raw.githubusercontent.com')) return { ok: true, text: async () => `RAW:${u}` };
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const src = await prepareResourceSource({
        ref: 'feature-branch',
        repoContentPrefix: 'plugins/weegloo',
      });
      assert.equal(src.mode, 'remote');
      const skill = await src.getSkillFile('s1', 'SKILL.md');
      assert.match(skill, /raw\.githubusercontent\.com/);
      assert.match(skill, /feature-branch\/plugins\/weegloo\/skills\/s1\/SKILL\.md$/);
      const rule = await src.getRuleText('r1');
      assert.match(rule, /feature-branch\/plugins\/weegloo\/rules\/r1\.mdc$/);
    }
  );
});

test('degrades to remote when the bundle zip is corrupt', async () => {
  await withMockedFetch(
    async (url) => {
      const u = String(url);
      if (u.endsWith('weegloo-bundle.zip')) {
        return { ok: true, arrayBuffer: async () => strToU8('not a zip').slice().buffer };
      }
      if (u.includes('raw.githubusercontent.com')) return { ok: true, text: async () => 'RAW-OK' };
      throw new Error(`unexpected fetch: ${u}`);
    },
    async () => {
      const src = await prepareResourceSource({ ref: 'v1.0.0', repoContentPrefix: 'plugins/weegloo' });
      assert.equal(src.mode, 'remote');
      assert.equal(await src.getRuleText('r1'), 'RAW-OK');
    }
  );
});
