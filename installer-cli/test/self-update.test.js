import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';

import {
  SELF_UPDATE_RULE_ID,
  VERSION_CHECK_INTERVAL_HOURS,
  isoNow,
  buildUpdateCommand,
  getVersionStampPath,
  buildStamp,
  writeVersionStamp,
  applySelfUpdateTemplate,
} from '../src/self-update.js';
import { VERSION_URL } from '../src/github.js';

const RULE = {
  id: SELF_UPDATE_RULE_ID,
  content: [
    'check {{WEEGLOO_VERSION_URL}}',
    'stamp {{WEEGLOO_STAMP_PATH}}',
    'window {{WEEGLOO_CHECK_INTERVAL_HOURS}} hours',
    'run: {{WEEGLOO_UPDATE_COMMAND}}',
    'again {{WEEGLOO_VERSION_URL}}', // proves ALL occurrences are replaced
  ].join('\n'),
};
const OTHER = { id: 'weegloo-global-rules', content: 'leave {{WEEGLOO_VERSION_URL}} alone' };

test('buildUpdateCommand pins the installer to @latest and refreshes skills/rules unattended (--no-mcp --yes)', () => {
  assert.equal(
    buildUpdateCommand({ agent: 'claude', ref: 'latest', scope: 'global' }),
    'npx weegloo@latest --agent claude --branch latest --location global --no-mcp --yes'
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
    agent: 'cursor',
    ref: 'latest',
    scope: 'project',
  });
  assert.ok(!/{{.*}}/.test(su.content), 'no placeholders remain');
  assert.equal(su.content.split(VERSION_URL).length - 1, 2, 'all version-URL slots filled');
  assert.ok(su.content.includes('npx weegloo@latest --agent cursor --branch latest --location project'));
  assert.ok(su.content.includes(`window ${VERSION_CHECK_INTERVAL_HOURS} hours`), 'interval baked in');
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

test('applySelfUpdateTemplate is a no-op when the version rule is absent', () => {
  const out = applySelfUpdateTemplate([OTHER], { version: 'v', agent: 'claude', ref: 'latest', scope: 'global' });
  assert.deepEqual(out, [OTHER]);
});

test('buildStamp wraps the last_check timestamp (the in-session re-check anchor)', () => {
  assert.deepEqual(buildStamp('2026-07-21T14:30:00'), { last_check: '2026-07-21T14:30:00' });
});

test('isoNow formats local time as YYYY-MM-DDTHH:mm:ss', () => {
  // Fixed local Date → deterministic (month is 0-based: 6 = July).
  assert.equal(isoNow(new Date(2026, 6, 21, 14, 30, 5)), '2026-07-21T14:30:05');
  assert.equal(isoNow(new Date(2026, 0, 3, 9, 8, 7)), '2026-01-03T09:08:07');
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

test('writeVersionStamp records the installed version alongside last_check (null → omitted)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weegloo-stamp-v-'));
  const file = path.join(dir, 'version-check.json');
  try {
    writeVersionStamp('global', '2026-07-21T14:30:00', file, '12');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-07-21T14:30:00', version: '12' });

    // A null version is omitted — backward compatible with the last_check-only stamp.
    writeVersionStamp('global', '2026-07-22T09:00:00', file, null);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-07-22T09:00:00' });
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
