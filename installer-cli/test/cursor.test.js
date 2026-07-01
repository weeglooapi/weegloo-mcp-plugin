import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getCursorGlobalMcpPath, getCursorMcpPath } from '../src/cursor.js';

test('Cursor global MCP path is OS-agnostic ~/.cursor/mcp.json', () => {
  const expected = path.join(os.homedir(), '.cursor', 'mcp.json');
  assert.equal(getCursorGlobalMcpPath(), expected);
  assert.equal(getCursorMcpPath('global'), expected);
});

test('Cursor project MCP path is .cursor/mcp.json under cwd', () => {
  const previousCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-cursor-paths-'));

  try {
    process.chdir(tmpDir);
    assert.equal(
      getCursorMcpPath('project'),
      path.join(process.cwd(), '.cursor', 'mcp.json')
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
