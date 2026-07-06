import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getCodexInstructionsPath,
  getCodexSkillsDir,
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
