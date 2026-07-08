import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliArgs, resolveConfig } from '../src/cli.js';

/** Resolve helper with sane defaults; override per case. */
function resolve(argv, { env = {}, isTTY = true } = {}) {
  return resolveConfig({ values: parseCliArgs(argv), env, isTTY, pkgPluginRef: 'latest' });
}

// ── parsing ───────────────────────────────────────────────────────────────

test('parseCliArgs: short aliases and booleans', () => {
  const v = parseCliArgs(['-b', '1.0.2', '-a', 'claude', '-l', 'global', '-y', '-d']);
  assert.deepEqual(v.branch, ['1.0.2']);
  assert.equal(v.agent, 'claude');
  assert.equal(v.location, 'global');
  assert.equal(v.yes, true);
  assert.equal(v['all-branches'], true);
});

test('parseCliArgs: --no-mcp is its own boolean (not generic negation)', () => {
  assert.equal(parseCliArgs(['--no-mcp'])['no-mcp'], true);
  assert.equal(parseCliArgs([])['no-mcp'], undefined);
});

test('parseCliArgs: unknown flag throws (caught + friendly upstream)', () => {
  assert.throws(() => parseCliArgs(['--nope']));
});

test('parseCliArgs: stray positionals are rejected (not silently swallowed)', () => {
  assert.throws(() => parseCliArgs(['--mcp', 'core', 'junk']), /Unexpected argument/);
  assert.throws(() => parseCliArgs(['claude']), /Unexpected argument/);
});

test('parseCliArgs: --mcp requires a value (missing / flag-like value both throw)', () => {
  assert.throws(() => parseCliArgs(['--mcp']));        // argument missing
  assert.throws(() => parseCliArgs(['--mcp', '-y']));  // ambiguous: -y is not a value
});

// ── happy-path resolution ───────────────────────────────────────────────────

test('resolveConfig: fully non-interactive MCP install needs only agent + token', () => {
  const { errors, config } = resolve(['-y', '-a', 'claude'], { env: { WEEGLOO_TOKEN: 'pat' } });
  assert.deepEqual(errors, []);
  assert.equal(config.nonInteractive, true);
  assert.equal(config.pluginRef, 'latest'); // baked-in default, no picker
  assert.equal(config.agent, 'claude');
  assert.equal(config.token, 'pat');
  assert.equal(config.installMcp, null); // unset ⇒ defaults to on downstream
  assert.equal(config.installSkillsRules, null);
});

test('resolveConfig: --mcp pins group and implies install; default ⇒ empty group', () => {
  assert.equal(resolve(['--mcp', 'default']).config.mcpGroup, '');
  assert.equal(resolve(['--mcp', 'core']).config.mcpGroup, 'core');
  assert.equal(resolve(['--mcp', 'core']).config.installMcp, true);
});

test('resolveConfig: --no-mcp disables MCP; skills-only is valid without token', () => {
  const { errors, config } = resolve(['-y', '-a', 'codex', '--no-mcp']);
  assert.deepEqual(errors, []);
  assert.equal(config.installMcp, false);
});

test('resolveConfig: token flag beats env; branch flag pins (skips picker)', () => {
  const { config } = resolve(['-b', '1.0.3', '-t', 'flagtok'], { env: { WEEGLOO_TOKEN: 'envtok', WEEGLOO_REF: '9.9.9' } });
  assert.equal(config.token, 'flagtok');
  assert.equal(config.pluginRef, '1.0.3');
  assert.equal(config.refPinned, true);
});

test('resolveConfig: --ignore-skill alone keeps skills/rules phase on (wants rules)', () => {
  assert.equal(resolve(['--ignore-skill']).config.installSkillsRules, true);
  assert.equal(resolve(['--ignore-skill', '--ignore-rule']).config.installSkillsRules, false);
});

// ── host (GUI wrapper) ──────────────────────────────────────────────────────

test('resolveConfig: --host xcode with a hostable agent resolves cleanly', () => {
  const { errors, config } = resolve(['-y', '-a', 'codex', '--host', 'xcode'], {
    env: { WEEGLOO_TOKEN: 'pat' },
  });
  assert.deepEqual(errors, []);
  assert.equal(config.agent, 'codex');
  assert.equal(config.host, 'xcode');
});

test('resolveConfig: --host defaults to null (no PATH injection)', () => {
  assert.equal(resolve(['-y', '-a', 'codex'], { env: { WEEGLOO_TOKEN: 'pat' } }).config.host, null);
});

test('resolveConfig: --host xcode rejects a non-hostable agent', () => {
  const { errors } = resolve(['-y', '-a', 'cursor', '--host', 'xcode'], { env: { WEEGLOO_TOKEN: 'pat' } });
  assert.ok(errors.some((e) => /--host xcode only works with --agent claude\/codex/.test(e)));
});

test('resolveConfig: invalid --host value is rejected', () => {
  assert.ok(resolve(['--host', 'vim']).errors.some((e) => /Invalid --host/.test(e)));
});

test('resolveConfig: --agent xcode points at --host instead', () => {
  const { errors } = resolve(['-y', '-a', 'xcode'], { env: { WEEGLOO_TOKEN: 'pat' } });
  assert.ok(errors.some((e) => /'xcode' is not an --agent/.test(e)));
});

test('resolveConfig: --host xcode with --no-mcp warns (PATH has no effect)', () => {
  const { errors, warnings } = resolve(['-y', '-a', 'codex', '--host', 'xcode', '--no-mcp']);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /--host xcode only affects the npx upload server/.test(w)));
});

// ── hard errors ─────────────────────────────────────────────────────────────

test('resolveConfig: --mcp + --no-mcp conflict', () => {
  const { errors } = resolve(['--mcp', 'core', '--no-mcp']);
  assert.ok(errors.some((e) => /--mcp and --no-mcp/.test(e)));
});

test('resolveConfig: nothing to install (--no-mcp + both ignores)', () => {
  const { errors } = resolve(['--no-mcp', '--ignore-skill', '--ignore-rule']);
  assert.ok(errors.some((e) => /Nothing to install/.test(e)));
});

test('resolveConfig: conflicting branch and ref values', () => {
  const { errors } = resolve(['--branch', '1.0.1', '--ref', '1.0.2']);
  assert.ok(errors.some((e) => /Conflicting branch refs/.test(e)));
  // same value is fine
  assert.deepEqual(resolve(['--branch', '1.0.1', '--ref', '1.0.1']).errors, []);
});

test('resolveConfig: invalid enum values are rejected with valid list', () => {
  assert.ok(resolve(['-a', 'vscode']).errors.some((e) => /Invalid --agent/.test(e)));
  assert.ok(resolve(['-l', 'somewhere']).errors.some((e) => /Invalid --location/.test(e)));
  assert.ok(resolve(['--mcp', 'mega']).errors.some((e) => /Invalid --mcp group/.test(e)));
});

test('resolveConfig: non-interactive requires --agent', () => {
  assert.ok(resolve(['-y'], { env: { WEEGLOO_TOKEN: 'pat' } }).errors.some((e) => /--agent is required/.test(e)));
});

test('resolveConfig: non-interactive + MCP needs a token', () => {
  assert.ok(resolve(['-y', '-a', 'claude']).errors.some((e) => /Personal Access Token is required/.test(e)));
  // --no-mcp removes the requirement
  assert.deepEqual(resolve(['-y', '-a', 'claude', '--no-mcp']).errors, []);
});

test('resolveConfig: non-TTY auto-enables non-interactive (same requirements)', () => {
  const { config, errors } = resolve(['-a', 'claude', '--no-mcp'], { isTTY: false });
  assert.equal(config.nonInteractive, true);
  assert.deepEqual(errors, []);
  // missing agent under non-TTY still errors
  assert.ok(resolve(['--no-mcp'], { isTTY: false }).errors.some((e) => /--agent is required/.test(e)));
});

// ── soft warnings ───────────────────────────────────────────────────────────

test('resolveConfig: token + --no-mcp warns (ignored), not an error', () => {
  const { errors, warnings } = resolve(['-t', 'pat', '--no-mcp']);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /token is ignored/.test(w)));
});

test('resolveConfig: --all-branches with a pinned branch warns (no-op)', () => {
  assert.ok(resolve(['-d', '-b', '1.0.2']).warnings.some((w) => /--all-branches has no effect/.test(w)));
});

// The Antigravity location no-op warning lives in index.js (it depends on values
// that may be chosen interactively), so resolveConfig must NOT emit it here.
