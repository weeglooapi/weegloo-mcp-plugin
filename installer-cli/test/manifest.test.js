import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  // Parser preserves advertisement order + dedups; ordering is the caller's concern.
  assert.deepEqual(parseBranchesFromInfoRefs(adv), ['latest', '1.0.12', 'develop']);
});

test('parseBranchesFromInfoRefs returns [] on empty / non-advertisement input', () => {
  assert.deepEqual(parseBranchesFromInfoRefs(''), []);
  assert.deepEqual(parseBranchesFromInfoRefs('garbage without refs'), []);
});

test('buildManifest is deterministic and embeds skill/rule text + MCP urls', () => {
  const manifest = buildManifest({ rootDir: REPO_ROOT });

  assert.equal(manifest.schemaVersion, 1);
  // Content fingerprint: non-empty, and a pure function of content (verified by the
  // byte-identical re-build below) so the regenerate-on-push idempotence guard holds.
  assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0, 'has version');
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

test('loadResources returns null when no manifest is reachable (caller fails fast)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  try {
    assert.equal(await loadResources('missing-branch'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildManifest throws when an existing .mcp.json is malformed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-mcp-bad-'));
  try {
    const contentRoot = path.join(root, 'plugins', 'weegloo');
    mkdirSync(path.join(contentRoot, 'skills', 's1'), { recursive: true });
    writeFileSync(path.join(contentRoot, 'skills', 's1', 'SKILL.md'), 'body');
    writeFileSync(path.join(contentRoot, '.mcp.json'), '{ not valid json ]');
    assert.throws(() => buildManifest({ rootDir: root }), /invalid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadResources returns null for an unsupported manifest schemaVersion', async () => {
  const v2 = {
    schemaVersion: 2,
    repoContentPrefix: 'plugins/weegloo',
    mcp: {},
    skills: [{ id: 'a', files: { 'SKILL.md': 'x' } }],
    rules: [],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(v2), { status: 200 })
      : new Response('not found', { status: 404 });
  try {
    assert.equal(await loadResources('latest'), null); // v2 rejected -> no usable manifest
  } finally {
    globalThis.fetch = realFetch;
  }
});

function stubManifest(manifest) {
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response('x', { status: 404 });
}

test('loadResources returns null for a malformed entry (strict — no silent drop)', async () => {
  const realFetch = globalThis.fetch;
  stubManifest({
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: { weeglooUrl: 'https://ai.weegloo.com/mcp', uploadApiUrl: 'https://upload.weegloo.com/v1' },
    skills: [
      { id: 'good', files: { 'SKILL.md': 'x' } },
      { id: 'bad', files: { 'SKILL.md': 123 } }, // non-string content → reject whole manifest
    ],
    rules: [{ id: 'r1', content: 'body' }],
  });
  try {
    assert.equal(await loadResources('latest'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadResources returns null when mcp URLs are missing (defaults belong to the producer)', async () => {
  const realFetch = globalThis.fetch;
  stubManifest({
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: {}, // no weeglooUrl/uploadApiUrl → reject (no consumer-side default)
    skills: [{ id: 'a', files: { 'SKILL.md': 'x' } }],
    rules: [{ id: 'r', content: 'body' }],
  });
  try {
    assert.equal(await loadResources('latest'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
