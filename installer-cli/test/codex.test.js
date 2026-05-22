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
