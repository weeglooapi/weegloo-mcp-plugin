import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { uploadServerCommand } from '../src/io.js';
import { buildWeeglooMcpToml } from '../src/codex.js';

const NODE = '/Users/me/.nvm/versions/node/v18.20.8/bin/node';
const BIN = '/Users/me/.nvm/versions/node/v18.20.8/bin';

test('uploadServerCommand (POSIX): no PATH env by default (terminal-launched)', () => {
  const result = uploadServerCommand({ execPath: NODE, platform: 'darwin' });
  assert.deepEqual(result, {
    command: 'npx',
    args: ['-y', 'weegloo-upload'],
    env: {},
  });
});

test('uploadServerCommand (POSIX): injectPath adds node bin dir to PATH', () => {
  const result = uploadServerCommand({ injectPath: true, execPath: NODE, platform: 'darwin' });
  assert.equal(result.command, 'npx'); // command stays bare; PATH does the work
  assert.deepEqual(result.args, ['-y', 'weegloo-upload']);
  // node bin dir first so npx and its `#!/usr/bin/env node` shebang both resolve.
  assert.equal(result.env.PATH, `${BIN}:/usr/bin:/bin`);
});

test('uploadServerCommand (Windows): cmd /c npx, no PATH env even with injectPath', () => {
  // npx.cmd locates node.exe next to itself; Xcode is macOS-only anyway.
  const win = { execPath: 'C:\\nodejs\\node.exe', platform: 'win32' };
  assert.deepEqual(uploadServerCommand(win), {
    command: 'cmd',
    args: ['/c', 'npx', '-y', 'weegloo-upload'],
    env: {},
  });
  assert.deepEqual(uploadServerCommand({ ...win, injectPath: true }), {
    command: 'cmd',
    args: ['/c', 'npx', '-y', 'weegloo-upload'],
    env: {},
  });
});

test('buildWeeglooMcpToml: no PATH line by default', () => {
  const toml = buildWeeglooMcpToml({
    weeglooUrl: 'https://ai.weegloo.com/mcp',
    uploadApiUrl: 'https://upload.weegloo.com/v1',
    token: 'PAT',
  });
  assert.doesNotMatch(toml, /^PATH =/m);
  assert.match(toml, /AUTH_BEARER_TOKEN = "PAT"/);
});

test('buildWeeglooMcpToml: injectPath emits a PATH env line for the running node', () => {
  const spec = uploadServerCommand({ injectPath: true });
  const toml = buildWeeglooMcpToml({
    weeglooUrl: 'https://ai.weegloo.com/mcp',
    uploadApiUrl: 'https://upload.weegloo.com/v1',
    token: 'PAT',
    injectPath: true,
  });
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(toml, new RegExp(`^PATH = "${escapeRe(spec.env.PATH)}"$`, 'm'));
  // The real launch dir is this test's own node bin.
  assert.match(toml, new RegExp(escapeRe(path.dirname(process.execPath))));
});
