import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';

import {
  SELF_UPDATE_RULE_ID,
  VERSION_CHECK_INTERVAL_DAYS,
  buildManifestUrl,
  buildUpdateCommand,
  getVersionStampPath,
  buildStamp,
  writeVersionStamp,
  applySelfUpdateTemplate,
} from '../src/self-update.js';

const RULE = {
  id: SELF_UPDATE_RULE_ID,
  content: [
    'installed_version: "{{WEEGLOO_INSTALLED_VERSION}}"',
    'fetch {{WEEGLOO_MANIFEST_URL}}',
    'stamp {{WEEGLOO_STAMP_PATH}}',
    'window {{WEEGLOO_CHECK_INTERVAL_DAYS}} days',
    'run: {{WEEGLOO_UPDATE_COMMAND}}',
    'again: {{WEEGLOO_INSTALLED_VERSION}}', // proves ALL occurrences are replaced
  ].join('\n'),
};
const OTHER = { id: 'weegloo-global-rules', content: 'leave {{WEEGLOO_INSTALLED_VERSION}} alone' };

test('buildManifestUrl points at the branch-native manifest on the given ref', () => {
  assert.equal(
    buildManifestUrl('latest'),
    'https://raw.githubusercontent.com/weeglooapi/weegloo-mcp-plugin/latest/plugins/weegloo/installer-manifest.json'
  );
  assert.ok(buildManifestUrl('1.0.12').includes('/1.0.12/'));
});

test('buildUpdateCommand refreshes skills/rules only (no MCP/token) for this agent/ref/scope', () => {
  assert.equal(
    buildUpdateCommand({ agent: 'claude', ref: 'latest', scope: 'global' }),
    'npx weegloo --agent claude --branch latest --location global --no-mcp --yes'
  );
});

test('getVersionStampPath follows the install scope (global → home, project → project root)', () => {
  assert.equal(getVersionStampPath('global'), path.join(os.homedir(), '.weegloo', 'version-check.json'));
  assert.equal(getVersionStampPath(), path.join(os.homedir(), '.weegloo', 'version-check.json')); // default global
  assert.equal(
    getVersionStampPath('project', '/proj'),
    path.join('/proj', '.weegloo', 'version-check.json')
  );
});

test('applySelfUpdateTemplate fills every placeholder in the version rule', () => {
  const [su] = applySelfUpdateTemplate([RULE], {
    version: 'abc123',
    agent: 'cursor',
    ref: 'latest',
    scope: 'project',
  });
  assert.ok(!/{{.*}}/.test(su.content), 'no placeholders remain');
  assert.equal((su.content.match(/abc123/g) || []).length, 2, 'all version slots filled');
  assert.ok(su.content.includes('--agent cursor --branch latest --location project'));
  assert.ok(su.content.includes('/latest/plugins/weegloo/installer-manifest.json'));
  assert.ok(su.content.includes(`window ${VERSION_CHECK_INTERVAL_DAYS} days`), 'interval baked in');
});

test('applySelfUpdateTemplate bakes a scope-appropriate stamp path', () => {
  // project → relative (resolved against project root, survives a move)
  const [proj] = applySelfUpdateTemplate([RULE], { version: 'v', agent: 'cursor', ref: 'latest', scope: 'project' });
  assert.ok(proj.content.includes('stamp .weegloo/version-check.json'));
  assert.ok(!proj.content.includes(os.homedir()), 'project scope does not bake the home path');
  // global → absolute under the user's home
  const [glob] = applySelfUpdateTemplate([RULE], { version: 'v', agent: 'claude', ref: 'latest', scope: 'global' });
  assert.ok(glob.content.includes(getVersionStampPath('global')));
});

test('applySelfUpdateTemplate leaves non-version rules byte-identical', () => {
  const out = applySelfUpdateTemplate([OTHER, RULE], { version: 'v', agent: 'claude', ref: 'latest', scope: 'global' });
  assert.equal(out[0].content, OTHER.content, 'other rule untouched (placeholder-looking text preserved)');
});

test('applySelfUpdateTemplate maps a null/empty version to "unknown" (rule then skips the check)', () => {
  for (const version of [null, '', undefined]) {
    const [su] = applySelfUpdateTemplate([RULE], { version, agent: 'claude', ref: 'latest', scope: 'global' });
    assert.ok(su.content.includes('installed_version: "unknown"'));
  }
});

test('applySelfUpdateTemplate is a no-op when the version rule is absent', () => {
  const out = applySelfUpdateTemplate([OTHER], { version: 'v', agent: 'claude', ref: 'latest', scope: 'global' });
  assert.deepEqual(out, [OTHER]);
});

test('buildStamp records only the last_check date (the 14-day window anchor)', () => {
  assert.deepEqual(buildStamp('2026-06-27'), { last_check: '2026-06-27' });
});

test('writeVersionStamp persists the stamp and is overwritten on re-install', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weegloo-stamp-'));
  const file = path.join(dir, 'sub', 'version-check.json'); // nested → tests mkdir -p
  try {
    const written = writeVersionStamp('global', '2026-06-01', file);
    assert.equal(written, file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-06-01' });

    // A later install/update resets the window to "now".
    writeVersionStamp('global', '2026-06-27', file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-06-27' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeVersionStamp is best-effort: returns null instead of throwing on an unwritable path', () => {
  // A path whose parent is an existing file (not a dir) cannot be created.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weegloo-stamp-'));
  const notADir = path.join(dir, 'file');
  writeVersionStamp('global', '2026-06-27', notADir); // create the blocking file first
  try {
    assert.equal(writeVersionStamp('global', '2026-06-27', path.join(notADir, 'nope.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
