import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBranchesFromInfoRefs, loadResources } from '../src/github.js';
import { buildManifest, serializeManifest } from '../../scripts/build-installer-manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Builds a fake git-upload-pack ref advertisement (pkt-line text). */
function advertise(refs) {
  let body = '0011# service=git-upload-pack\n0000';
  let first = true;
  for (const [sha, ref] of refs) {
    const caps = first ? '\0multi_ack symref=HEAD:refs/heads/latest' : '';
    body += `0000${sha} ${ref}${caps}\n`;
    first = false;
  }
  return `${body}0000`;
}

test('parseBranchesFromInfoRefs extracts heads, drops capabilities and tags', () => {
  const adv = advertise([
    ['a'.repeat(40), 'refs/heads/latest'],
    ['b'.repeat(40), 'refs/heads/1.0.12'],
    ['c'.repeat(40), 'refs/heads/develop'],
    ['d'.repeat(40), 'refs/tags/v1.0.0'],
  ]);
  assert.deepEqual(parseBranchesFromInfoRefs(adv), ['1.0.12', 'develop', 'latest']);
});

test('parseBranchesFromInfoRefs returns [] on empty / non-advertisement input', () => {
  assert.deepEqual(parseBranchesFromInfoRefs(''), []);
  assert.deepEqual(parseBranchesFromInfoRefs('garbage without refs'), []);
});

test('buildManifest is deterministic and embeds skill/rule text + MCP urls', () => {
  const manifest = buildManifest({ rootDir: REPO_ROOT });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repoContentPrefix, 'plugins/weegloo');
  assert.ok(manifest.mcp.weeglooUrl.length > 0 && manifest.mcp.uploadApiUrl.length > 0);
  assert.ok(manifest.skills.length > 0, 'has skills');
  assert.ok(manifest.rules.length > 0, 'has rules');

  for (const skill of manifest.skills) {
    assert.ok(typeof skill.id === 'string' && skill.id.length > 0);
    assert.ok('SKILL.md' in skill.files, `${skill.id} embeds SKILL.md`);
    assert.ok(skill.files['SKILL.md'].length > 0);
  }
  for (const rule of manifest.rules) {
    assert.ok(typeof rule.content === 'string' && rule.content.length > 0);
  }

  // No volatile fields — required for the regenerate-on-push idempotence guard.
  assert.ok(!('generatedAt' in manifest) && !('commit' in manifest));

  // Same content -> byte-identical output.
  assert.equal(
    serializeManifest(buildManifest({ rootDir: REPO_ROOT })),
    serializeManifest(manifest)
  );
});

test('loadResources normalizes a manifest fetched from raw', async () => {
  const manifest = {
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: { weeglooUrl: 'https://dev-ai.weegloo.com/mcp', uploadApiUrl: 'https://dev-upload.weegloo.com/v1' },
    skills: [{ id: 'a', files: { 'SKILL.md': 'hi', 'metadata.json': '{}' } }],
    rules: [{ id: 'r', content: 'rule body' }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response('not found', { status: 404 });
  try {
    const r = await loadResources('dev-latest');
    assert.equal(r.source, 'manifest');
    assert.equal(r.mcp.weeglooUrl, 'https://dev-ai.weegloo.com/mcp');
    assert.deepEqual(r.skills, [{ id: 'a', files: { 'SKILL.md': 'hi', 'metadata.json': '{}' } }]);
    assert.deepEqual(r.rules, [{ id: 'r', content: 'rule body' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadResources falls back to empty defaults when nothing is reachable', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  try {
    const r = await loadResources('missing-branch');
    assert.equal(r.source, 'none');
    assert.deepEqual(r.skills, []);
    assert.deepEqual(r.rules, []);
    assert.ok(r.mcp.weeglooUrl.length > 0, 'mcp falls back to defaults');
  } finally {
    globalThis.fetch = realFetch;
  }
});
