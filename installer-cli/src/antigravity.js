import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';
import { writeContentFile, uploadServerCommand, removeSkillDirs } from './io.js';
import { upsertRuleInAgentsMd, removeRuleMarkers } from './codex.js';
import { applySelfUpdateTemplate, syncInstalledRecord } from './self-update.js';

/**
 * Antigravity (Google's agentic IDE, Gemini-based) target.
 *
 * Paths differ by scope:
 *
 *   Global (~/.gemini/):
 *     ├── config/mcp_config.json   ← MCP servers
 *     ├── skills/<id>/             ← skills
 *     └── GEMINI.md                ← behavioral rules (Antigravity global context file)
 *
 *   Project (<cwd>/):
 *     ├── AGENTS.md                ← behavioral rules (portable, project context file)
 *     └── .agents/
 *         ├── mcp_config.json      ← MCP servers
 *         └── skills/<id>/         ← skills
 *
 * Rules are NOT written as separate files here: they are merged (marker per rule id,
 * upsert-in-place) into GEMINI.md (global) or AGENTS.md (project) so re-installs update
 * sections instead of duplicating content. Both are plain Markdown context files.
 */

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function buildMcpUrlWithGroup(baseUrl, group) {
  if (!group) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}group=${encodeURIComponent(group)}`;
}

/** MCP config path by scope. */
export function getAntigravityMcpPath(scope = 'global') {
  return scope === 'global'
    ? path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json')
    : path.join(process.cwd(), '.agents', 'mcp_config.json');
}

/** Skills directory by scope. */
export function getAntigravitySkillsDir(scope = 'global') {
  return scope === 'global'
    ? path.join(os.homedir(), '.gemini', 'skills')
    : path.join(process.cwd(), '.agents', 'skills');
}

/** Behavioral-rules Markdown file by scope: GEMINI.md (global) vs AGENTS.md (project). */
export function getAntigravityRulesFile(scope = 'global') {
  return scope === 'global'
    ? path.join(os.homedir(), '.gemini', 'GEMINI.md')
    : path.join(process.cwd(), 'AGENTS.md');
}

export async function installAntigravity({
  token,
  pluginRef,
  version,
  mcpGroup,
  skills,
  rules,
  mcp = {},
  scope,
  installMcp,
  installSkillsRules,
  manageSkills = false,
  manageRules = false,
  installedSkillIds = [],
  installedRuleIds = [],
}) {
  // Bake this install's version + refresh command into the self-update rule (option B).
  rules = applySelfUpdateTemplate(rules, { version, agent: 'antigravity', ref: pluginRef, scope });

  const skillsDir = getAntigravitySkillsDir(scope);
  const rulesFile = getAntigravityRulesFile(scope);

  console.log(chalk.bold('  ▶  Installing for Antigravity...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = mcp;
    const mcpPath = getAntigravityMcpPath(scope);
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(path.dirname(mcpPath));
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      config.mcpServers['weegloo'] = {
        serverUrl: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
      };
      const { command, args } = uploadServerCommand();
      config.mcpServers['weegloo-upload'] = {
        command,
        args,
        env: {
          UPLOAD_API_URL: uploadApiUrl,
          AUTH_BEARER_TOKEN: token,
        },
      };

      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
      mcpSpinner.succeed(
        `  MCP servers configured  ${chalk.dim('→ ' + mcpPath)}`
      );
    } catch (err) {
      mcpSpinner.fail(`  Failed to configure MCP servers: ${err.message}`);
    }
  } else {
    console.log(chalk.dim('  - MCP servers: skipped (Skills/Rules only)'));
  }

  // ── Skills download & install ───────────────────────────────
  if (!installSkillsRules) {
    console.log(chalk.dim('  - Skills: skipped (MCP only)'));
  } else if (skills.length === 0) {
    console.log(chalk.dim('  - Skills: none selected, skipping'));
  } else {
    const skillsSpinner = ora({ text: `  Installing skills (0/${skills.length})`, indent: 0 }).start();
    try {
      ensureDir(skillsDir);
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillsSpinner.text = `  Installing skills (${i + 1}/${skills.length}) ${chalk.dim(skill.id)}`;
        const destDir = path.join(skillsDir, skill.id);
        for (const [fileName, content] of Object.entries(skill.files)) {
          writeContentFile(path.join(destDir, fileName), content);
        }
      }
      skillsSpinner.succeed(
        `  Skills installed   ${chalk.dim(`(${skills.length})  → ${skillsDir}`)}`
      );
    } catch (err) {
      skillsSpinner.fail(`  Failed to install skills: ${err.message}`);
    }
  }

  // ── Rules download & install (→ GEMINI.md global / AGENTS.md project) ────────
  if (!installSkillsRules) {
    console.log(chalk.dim('  - Rules: skipped (MCP only)'));
  } else if (rules.length === 0) {
    console.log(chalk.dim('  - Rules: none selected, skipping'));
  } else {
    const rulesSpinner = ora({ text: `  Installing rules (0/${rules.length})`, indent: 0 }).start();
    try {
      ensureDir(path.dirname(rulesFile));
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Installing rules (${i + 1}/${rules.length}) ${chalk.dim(rule.id)}`;
        // Marker-per-rule upsert: re-installs replace the section in place (no duplication).
        upsertRuleInAgentsMd(rulesFile, rule.id, rule.content);
      }
      rulesSpinner.succeed(
        `  Rules installed    ${chalk.dim(`(${rules.length})  → ${rulesFile}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
  }

  // Reconcile with the version-check.json record: remove any skill/rule we installed before but
  // are not installing now (deleted upstream OR deselected), rewrite the record, and re-stamp the
  // version check. Antigravity rules live as marker sections inside GEMINI.md / AGENTS.md.
  if (installSkillsRules) {
    const { removedSkills, removedRules, stampPath } = syncInstalledRecord({
      scope,
      version,
      manageSkills,
      installedSkillIds,
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules,
      installedRuleIds,
      removeRules: (ids) => removeRuleMarkers(rulesFile, ids),
    });
    if (removedSkills.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedSkills.length} stale skill(s): ${removedSkills.join(', ')}`));
    }
    if (removedRules.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedRules.length} stale rule(s): ${removedRules.join(', ')}`));
    }
    if (stampPath) console.log(chalk.dim(`  - Version check armed  → ${stampPath}`));
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Antigravity to apply the MCP server configuration.'));
}
