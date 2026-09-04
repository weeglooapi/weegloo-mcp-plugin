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

// ── --update mode ───────────────────────────────────────────────────────────

test('resolveConfig: --update needs only --agent — no token, MCP forced off', () => {
  const { config, errors } = resolve(['--update', '-a', 'claude']);
  assert.deepEqual(errors, []);
  assert.equal(config.update, true);
  assert.equal(config.installMcp, false);
  assert.equal(config.installSkillsRules, true);
});

test('resolveConfig: --update without --agent errors (even in a TTY)', () => {
  assert.ok(resolve(['--update']).errors.some((e) => /--agent is required with --update/.test(e)));
});

test('resolveConfig: --update rejects --mcp (updates never touch MCP config)', () => {
  assert.ok(
    resolve(['--update', '-a', 'claude', '--mcp', 'core']).errors.some((e) =>
      /--mcp cannot be combined with --update/.test(e)
    )
  );
});

test('resolveConfig: --update with a token warns (ignored), not an error', () => {
  const { errors, warnings } = resolve(['--update', '-a', 'claude', '-t', 'pat']);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /--update never needs one/.test(w)));
});

test('resolveConfig: --update leaves an unpinned ref null so the agent stamp can supply the branch', () => {
  // Even non-interactive: defaulting to latest here would silently migrate a pinned install.
  const { config } = resolve(['--update', '-a', 'claude', '-y']);
  assert.equal(config.pluginRef, null);
  // An explicit --branch still pins.
  assert.equal(resolve(['--update', '-a', 'claude', '-b', 'develop']).config.pluginRef, 'develop');
});

test('resolveConfig: --update with both kinds ignored errors (nothing to update)', () => {
  assert.ok(
    resolve(['--update', '-a', 'claude', '--ignore-skill', '--ignore-rule']).errors.some((e) =>
      /Nothing to update/.test(e)
    )
  );
});

test('resolveConfig: --update with one kind ignored is a valid single-kind update', () => {
  const { config, errors } = resolve(['--update', '-a', 'cursor', '--ignore-rule']);
  assert.deepEqual(errors, []);
  assert.equal(config.ignoreRule, true);
  assert.equal(config.installSkillsRules, true);
});

// ── --origins (환경/엔터프라이즈 매핑) ──────────────────────────────────────

test('resolveConfig: --origins is carried raw (flag > env), install mode', () => {
  assert.equal(resolve(['-a', 'claude', '--no-mcp', '--origins', './origins.json']).config.origins, './origins.json');
  assert.equal(
    resolve(['-a', 'claude', '--no-mcp'], { env: { WEEGLOO_ORIGINS: '{"cma":"https://cma.acme.com"}' } }).config.origins,
    '{"cma":"https://cma.acme.com"}'
  );
  assert.equal(resolve(['-a', 'claude', '--no-mcp']).config.origins, null);
});

test('resolveConfig: --update rejects --origins — ignoring would be a false success (env switch cannot happen in update)', () => {
  assert.ok(
    resolve(['--update', '-a', 'claude', '--origins', './origins.json']).errors.some((e) =>
      /--origins cannot be combined with --update/.test(e)
    )
  );
  // env로 흘러들어와도 동일하게 거부 (CI 환경변수 잔존 사고 방지)
  assert.ok(
    resolve(['--update', '-a', 'claude'], { env: { WEEGLOO_ORIGINS: './origins.json' } }).errors.some((e) =>
      /--origins cannot be combined with --update/.test(e)
    )
  );
});

// ── --uninstall mode ────────────────────────────────────────────────────────

test('resolveConfig: --uninstall needs no agent in a TTY (detection asks) and no token', () => {
  const { config, errors } = resolve(['--uninstall']);
  assert.deepEqual(errors, []);
  assert.equal(config.uninstall, true);
  assert.equal(config.agent, null, 'interactive detection supplies the target');
  assert.equal(config.pluginRef, null, 'nothing is fetched, so no branch is resolved');
});

test('resolveConfig: -u is the short form and needs --agent non-interactively', () => {
  assert.equal(resolve(['-u']).config.uninstall, true);
  assert.ok(
    resolve(['-u'], { isTTY: false }).errors.some((e) =>
      /--agent is required with --uninstall/.test(e)
    )
  );
  assert.deepEqual(resolve(['-u', '-a', 'claude'], { isTTY: false }).errors, []);
});

test('resolveConfig: --uninstall never defaults the branch, even non-interactively', () => {
  assert.equal(resolve(['-u', '-a', 'claude'], { isTTY: false }).config.pluginRef, null);
});

test('resolveConfig: --uninstall and --update cannot be combined', () => {
  assert.ok(
    resolve(['--uninstall', '--update', '-a', 'claude']).errors.some((e) =>
      /--uninstall and --update cannot be used together/.test(e)
    )
  );
});

test('resolveConfig: --uninstall rejects --mcp <group> and points at --no-mcp', () => {
  assert.ok(
    resolve(['--uninstall', '-a', 'claude', '--mcp', 'all']).errors.some((e) =>
      /--mcp <group> cannot be combined with --uninstall/.test(e)
    )
  );
});

test('resolveConfig: the install opt-outs scope the removal ("leave this kind alone")', () => {
  const all = resolve(['-u', '-a', 'claude']).config;
  assert.deepEqual(
    [all.uninstallMcp, all.uninstallSkills, all.uninstallRules],
    [true, true, true],
    'default is a full removal'
  );

  const keepMcp = resolve(['-u', '-a', 'claude', '--no-mcp']).config;
  assert.equal(keepMcp.uninstallMcp, false);
  assert.equal(keepMcp.uninstallSkills, true);

  const filesOnly = resolve(['-u', '-a', 'claude', '--ignore-skill', '--ignore-rule']).config;
  assert.deepEqual(
    [filesOnly.uninstallMcp, filesOnly.uninstallSkills, filesOnly.uninstallRules],
    [true, false, false]
  );
});

test('resolveConfig: --uninstall excluding all three kinds errors (nothing to remove)', () => {
  assert.ok(
    resolve(['-u', '-a', 'claude', '--no-mcp', '--ignore-skill', '--ignore-rule']).errors.some((e) =>
      /Nothing to uninstall/.test(e)
    )
  );
});

test('resolveConfig: --uninstall warns (never errors) on flags that cannot apply', () => {
  const { errors, warnings } = resolve([
    '-u', '-a', 'claude', '-t', 'pat', '-b', 'develop', '--origins', './origins.json',
  ]);
  assert.deepEqual(errors, [], 'ignoring these still yields exactly what was asked');
  assert.ok(warnings.some((w) => /--uninstall never needs one/.test(w)), 'token');
  assert.ok(warnings.some((w) => /reads no manifest/.test(w)), 'branch');
  assert.ok(warnings.some((w) => /--origins has no effect with --uninstall/.test(w)));
});

test('resolveConfig: --uninstall does not trip the install-only "nothing to install" check', () => {
  const { errors } = resolve(['-u', '-a', 'claude', '--no-mcp', '--ignore-skill']);
  assert.deepEqual(errors, []);
});

test('resolveConfig: uninstall fields are null outside uninstall mode', () => {
  const { config } = resolve(['-a', 'claude', '-y', '-t', 'pat']);
  assert.equal(config.uninstall, false);
  assert.deepEqual(
    [config.uninstallMcp, config.uninstallSkills, config.uninstallRules],
    [null, null, null]
  );
});
