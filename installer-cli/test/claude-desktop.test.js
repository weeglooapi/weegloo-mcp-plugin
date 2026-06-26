import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getClaudeDesktopConfigPath, installClaudeDesktop } from '../src/claude-desktop.js';

/** Run a fn with HOME/USERPROFILE/APPDATA pointed at a throwaway dir, then restore. */
function withTempHome(fn) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-claude-desktop-'));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
  };
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming');
  return Promise.resolve(fn(tmpHome)).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });
}

test('Claude Desktop config path matches the OS app-data location (not Claude Code)', () => {
  const home = os.homedir();
  const expected =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'win32'
        ? path.join(
            process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
            'Claude',
            'claude_desktop_config.json'
          )
        : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  assert.equal(getClaudeDesktopConfigPath(), expected);
});

test('installClaudeDesktop bridges the HTTP server via mcp-remote and keeps upload as stdio', () =>
  withTempHome(async () => {
    await installClaudeDesktop({
      token: 'pat-123',
      pluginRef: 'latest',
      mcpGroup: 'core',
      mcp: { weeglooUrl: 'https://mcp.weegloo.com/v1', uploadApiUrl: 'https://upload.weegloo.com' },
      installMcp: true,
    });

    const cfg = JSON.parse(fs.readFileSync(getClaudeDesktopConfigPath(), 'utf-8'));

    // weegloo: remote HTTP bridged through mcp-remote (stdio), with the group appended.
    assert.deepEqual(cfg.mcpServers.weegloo, {
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.weegloo.com/v1?group=core'],
    });
    // weegloo-upload: native stdio server, PAT carried in env (works in Desktop as-is).
    assert.equal(cfg.mcpServers['weegloo-upload'].command, 'npx');
    assert.deepEqual(cfg.mcpServers['weegloo-upload'].args, ['-y', 'weegloo-upload']);
    assert.equal(cfg.mcpServers['weegloo-upload'].env.AUTH_BEARER_TOKEN, 'pat-123');
    assert.equal(cfg.mcpServers['weegloo-upload'].env.UPLOAD_API_URL, 'https://upload.weegloo.com');
  }));

test('installClaudeDesktop merges into an existing config and leaves other servers intact', () =>
  withTempHome(async () => {
    const cfgPath = getClaudeDesktopConfigPath();
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { other: { command: 'foo' } } }), 'utf-8');

    await installClaudeDesktop({
      token: 'pat',
      pluginRef: 'latest',
      mcpGroup: '', // default group ⇒ no query string appended
      mcp: { weeglooUrl: 'https://mcp.weegloo.com/v1', uploadApiUrl: 'https://upload.weegloo.com' },
      installMcp: true,
    });

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.equal(cfg.mcpServers.other.command, 'foo'); // pre-existing server preserved
    assert.deepEqual(cfg.mcpServers.weegloo.args, ['-y', 'mcp-remote', 'https://mcp.weegloo.com/v1']);
  }));
