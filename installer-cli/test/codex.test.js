import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureCodexProjectTrust,
  getCodexInstructionsPath,
  getCodexSkillsDir,
  readCodexProjectTrust,
  upsertRuleInAgentsMd,
} from '../src/codex.js';

test('Codex project instructions and skills use auto-discovered paths', () => {
  const previousCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-paths-'));

  try {
    process.chdir(tmpDir);
    const cwd = process.cwd();

    assert.equal(getCodexInstructionsPath('project'), path.join(cwd, 'AGENTS.md'));
    assert.equal(getCodexSkillsDir('project'), path.join(cwd, '.agents', 'skills'));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Codex global instructions and skills use auto-discovered paths', () => {
  assert.equal(
    getCodexInstructionsPath('global'),
    path.join(os.homedir(), '.codex', 'AGENTS.md')
  );
  assert.equal(
    getCodexSkillsDir('global'),
    path.join(os.homedir(), '.agents', 'skills')
  );
});

test('upsertRuleInAgentsMd appends and replaces marked Weegloo sections', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-agents-'));
  const agentsPath = path.join(tmpDir, 'AGENTS.md');

  try {
    fs.writeFileSync(agentsPath, '# Existing guidance\n\nKeep this line.\n', 'utf-8');

    upsertRuleInAgentsMd(agentsPath, 'weegloo-global-rules', 'First rule body');
    upsertRuleInAgentsMd(agentsPath, 'weegloo-global-rules', 'Updated rule body');

    const content = fs.readFileSync(agentsPath, 'utf-8');

    assert.match(content, /# Existing guidance/);
    assert.match(content, /Keep this line\./);
    assert.match(content, /<!-- weegloo:weegloo-global-rules -->/);
    assert.match(content, /Updated rule body/);
    assert.doesNotMatch(content, /First rule body/);
    assert.match(content, /<!-- \/weegloo:weegloo-global-rules -->/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('upsertRuleInAgentsMd writes a single UTF-8 BOM (Windows detects UTF-8, not ANSI)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-agents-bom-'));
  const agentsPath = path.join(tmpDir, 'GEMINI.md');

  try {
    // Rule body with non-ASCII (Korean) — the case that renders as garbled ANSI without a BOM.
    upsertRuleInAgentsMd(agentsPath, 'weegloo-global-rules', '한글 규칙 본문');
    // Re-run (idempotency): the BOM must not be duplicated or pushed mid-file.
    upsertRuleInAgentsMd(agentsPath, 'weegloo-global-rules', '한글 규칙 본문 v2');

    const bytes = fs.readFileSync(agentsPath); // raw buffer, no decoding
    // Exactly one leading UTF-8 BOM (EF BB BF), and none elsewhere.
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const bomCount = bytes.filter((b, i) => b === 0xef && bytes[i + 1] === 0xbb && bytes[i + 2] === 0xbf).length;
    assert.equal(bomCount, 1, 'expected exactly one UTF-8 BOM');

    // Content round-trips as UTF-8 (decode after the 3-byte BOM).
    const text = bytes.subarray(3).toString('utf-8');
    assert.match(text, /한글 규칙 본문 v2/);
    assert.doesNotMatch(text, /본문 v2 v2/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureCodexProjectTrust appends a trusted entry and is idempotent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-trust-'));
  const configPath = path.join(tmpDir, 'config.toml');
  // Path with a space — the realistic case that breaks naive quoting.
  const projectDir = '/Users/someone/My Project';

  try {
    fs.writeFileSync(configPath, '[mcp_servers.node_repl]\ncommand = "node"\n', 'utf-8');

    const first = ensureCodexProjectTrust(projectDir, configPath);
    assert.equal(first.status, 'added');
    assert.equal(first.trustLevel, 'trusted');

    const content = fs.readFileSync(configPath, 'utf-8');
    assert.match(content, /\[mcp_servers\.node_repl\]/); // existing config preserved
    assert.match(content, /\[projects\."\/Users\/someone\/My Project"\]/);
    assert.match(content, /trust_level = "trusted"/);

    const second = ensureCodexProjectTrust(projectDir, configPath);
    assert.equal(second.status, 'exists');
    assert.equal(second.trustLevel, 'trusted');
    const occurrences = fs.readFileSync(configPath, 'utf-8').match(/\[projects\./g);
    assert.equal(occurrences.length, 1, 'expected exactly one [projects.…] entry');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureCodexProjectTrust creates the user config when missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-trust-new-'));
  const configPath = path.join(tmpDir, 'home', '.codex', 'config.toml');

  try {
    const result = ensureCodexProjectTrust('/tmp/proj', configPath);
    assert.equal(result.status, 'added');
    const content = fs.readFileSync(configPath, 'utf-8');
    assert.match(content, /\[projects\."\/tmp\/proj"\]/);
    assert.match(content, /trust_level = "trusted"/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureCodexProjectTrust never overrides an explicit untrusted decision', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-untrusted-'));
  const configPath = path.join(tmpDir, 'config.toml');
  const projectDir = '/Users/someone/proj';

  try {
    const original = `[projects."${projectDir}"]\ntrust_level = "untrusted"\n`;
    fs.writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexProjectTrust(projectDir, configPath);
    assert.equal(result.status, 'exists');
    assert.equal(result.trustLevel, 'untrusted');
    assert.equal(fs.readFileSync(configPath, 'utf-8'), original, 'config must be unchanged');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readCodexProjectTrust round-trips Windows paths with escaped backslashes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-codex-win-'));
  const configPath = path.join(tmpDir, 'config.toml');
  const projectDir = 'C:\\Users\\me\\My Project';

  try {
    const first = ensureCodexProjectTrust(projectDir, configPath);
    assert.equal(first.status, 'added');

    const content = fs.readFileSync(configPath, 'utf-8');
    // Backslashes must be escaped in the basic-string key: C:\\Users\\me\\My Project
    assert.match(content, /\[projects\."C:\\\\Users\\\\me\\\\My Project"\]/);

    // The escaped key must unquote back to the original path (idempotency check).
    assert.deepEqual(readCodexProjectTrust(content, projectDir), {
      found: true,
      trustLevel: 'trusted',
    });
    const second = ensureCodexProjectTrust(projectDir, configPath);
    assert.equal(second.status, 'exists');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
