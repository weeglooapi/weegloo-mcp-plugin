import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';

import {
  SELF_UPDATE_RULE_ID,
  CORE_RULE_IDS,
  VERSION_CHECK_INTERVAL_HOURS,
  isoNow,
  buildUpdateCommand,
  getVersionStampPath,
  buildStamp,
  partitionCoreRules,
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

test('CORE_RULE_IDS forces exactly the update notifier and the terms gate', () => {
  assert.deepEqual(CORE_RULE_IDS, ['weegloo-version', 'weegloo-terms-consent']);
});

test('partitionCoreRules splits core vs optional, preserving manifest order', () => {
  const manifest = [
    { id: 'weegloo-global-rules', content: 'a' },
    { id: 'weegloo-version', content: 'b' },
    { id: 'weegloo-api-endpoints', content: 'c' },
    { id: 'weegloo-terms-consent', content: 'd' },
  ];
  const { core, optional } = partitionCoreRules(manifest);
  assert.deepEqual(core.map((r) => r.id), ['weegloo-version', 'weegloo-terms-consent']);
  assert.deepEqual(optional.map((r) => r.id), ['weegloo-global-rules', 'weegloo-api-endpoints']);
});

test('partitionCoreRules invents nothing when a core rule is absent from the manifest (old branch)', () => {
  const manifest = [
    { id: 'weegloo-version', content: 'b' }, // terms-consent predates this branch
    { id: 'weegloo-global-rules', content: 'a' },
  ];
  const { core, optional } = partitionCoreRules(manifest);
  assert.deepEqual(core.map((r) => r.id), ['weegloo-version']);
  assert.deepEqual(optional.map((r) => r.id), ['weegloo-global-rules']);
});

test('partitionCoreRules on an all-core manifest leaves the picker list empty (checkbox must be skipped)', () => {
  const manifest = [
    { id: 'weegloo-version', content: 'b' },
    { id: 'weegloo-terms-consent', content: 'd' },
  ];
  const { core, optional } = partitionCoreRules(manifest);
  assert.equal(core.length, 2);
  assert.deepEqual(optional, []);
});

test('buildUpdateCommand is minimal: installer @latest + agent/scope + --update, nothing else', () => {
  assert.equal(
    buildUpdateCommand({ agent: 'claude', scope: 'global' }),
    'npx weegloo@latest --agent claude --location global --update'
  );
  const cmd = buildUpdateCommand({ agent: 'cursor', scope: 'project' });
  assert.equal(cmd, 'npx weegloo@latest --agent cursor --location project --update');
  // No --branch: the update reads the branch from the agent's stamp ref (→ latest fallback);
  // no --yes: update mode has nothing to prompt for, and it would mute the conflict question.
  assert.ok(!cmd.includes('--branch'));
  assert.ok(!cmd.includes('--yes'));
});

test('getVersionStampPath is per-agent and follows the install scope', () => {
  assert.equal(
    getVersionStampPath('global', 'claude'),
    path.join(os.homedir(), '.weegloo', 'claude', 'version-check.json')
  );
  assert.equal(
    getVersionStampPath('project', 'cursor', '/proj'),
    path.join('/proj', '.weegloo', 'cursor', 'version-check.json')
  );
  // Different agents never share a stamp — one agent's install must not silence another's check.
  assert.notEqual(getVersionStampPath('global', 'claude'), getVersionStampPath('global', 'cursor'));
});

test('applySelfUpdateTemplate fills every placeholder in the version rule', () => {
  const [su] = applySelfUpdateTemplate([RULE], {
    agent: 'cursor',
    ref: 'latest',
    scope: 'project',
  });
  assert.ok(!/{{.*}}/.test(su.content), 'no placeholders remain');
  assert.equal(su.content.split(`${VERSION_URL}?branch=latest`).length - 1, 2, 'all version-URL slots filled, branch-scoped');
  assert.ok(su.content.includes('npx weegloo@latest --agent cursor --location project --update'));
  assert.ok(su.content.includes(`window ${VERSION_CHECK_INTERVAL_HOURS} hours`), 'interval baked in');
});

test('applySelfUpdateTemplate bakes a branch-scoped check URL (ref URL-encoded)', () => {
  // The bare endpoint answers for latest; a pinned install must ask about ITS branch.
  const [su] = applySelfUpdateTemplate([RULE], { agent: 'claude', ref: 'feat/x', scope: 'global' });
  assert.ok(su.content.includes(`${VERSION_URL}?branch=feat%2Fx`), 'ref is encoded into the query');
});

test('applySelfUpdateTemplate bakes a scope-appropriate PER-AGENT stamp path', () => {
  // project → relative (resolved against project root, survives a move)
  const [proj] = applySelfUpdateTemplate([RULE], { agent: 'cursor', ref: 'latest', scope: 'project' });
  assert.ok(proj.content.includes('stamp .weegloo/cursor/version-check.json'));
  assert.ok(!proj.content.includes(os.homedir()), 'project scope does not bake the home path');
  // global → absolute under the user's home, still per-agent
  const [glob] = applySelfUpdateTemplate([RULE], { agent: 'claude', ref: 'latest', scope: 'global' });
  assert.ok(glob.content.includes(getVersionStampPath('global', 'claude')));
});

test('applySelfUpdateTemplate leaves non-version rules byte-identical', () => {
  const out = applySelfUpdateTemplate([OTHER, RULE], { agent: 'claude', ref: 'latest', scope: 'global' });
  assert.equal(out[0].content, OTHER.content, 'other rule untouched (placeholder-looking text preserved)');
});

test('applySelfUpdateTemplate is a no-op when the version rule is absent', () => {
  const out = applySelfUpdateTemplate([OTHER], { agent: 'claude', ref: 'latest', scope: 'global' });
  assert.deepEqual(out, [OTHER]);
});

test('buildStamp carries last_check + installed version + ref (nulls omitted, legacy-compatible)', () => {
  assert.deepEqual(buildStamp('2026-07-21T14:30:00'), { last_check: '2026-07-21T14:30:00' });
  assert.deepEqual(buildStamp('2026-07-21T14:30:00', '12', 'develop'), {
    last_check: '2026-07-21T14:30:00',
    version: '12',
    ref: 'develop',
  });
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
    const written = writeVersionStamp(file, { now: '2026-06-01' });
    assert.equal(written, file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-06-01' });

    // A later install/update resets the window to "now".
    writeVersionStamp(file, { now: '2026-06-27' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-06-27' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeVersionStamp records the installed version + branch ref alongside last_check (nulls → omitted)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weegloo-stamp-v-'));
  const file = path.join(dir, 'version-check.json');
  try {
    writeVersionStamp(file, { now: '2026-07-21T14:30:00', version: '12', ref: 'develop' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), {
      last_check: '2026-07-21T14:30:00',
      version: '12',
      ref: 'develop',
    });

    // Nulls are omitted — backward compatible with the last_check-only stamp.
    writeVersionStamp(file, { now: '2026-07-22T09:00:00' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf-8')), { last_check: '2026-07-22T09:00:00' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeVersionStamp is best-effort: returns null instead of throwing on an unwritable path', () => {
  // A path whose parent is an existing file (not a dir) cannot be created.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weegloo-stamp-'));
  const notADir = path.join(dir, 'file');
  writeVersionStamp(notADir, { now: '2026-06-27' }); // create the blocking file first
  try {
    assert.equal(writeVersionStamp(path.join(notADir, 'nope.json'), { now: '2026-06-27' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
