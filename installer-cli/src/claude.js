import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';
import { writeContentFile, uploadServerCommand, removeSkillDirs, removeRuleFiles } from './io.js';
import { applySelfUpdateTemplate, syncInstalledRecord } from './self-update.js';

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

/**
 * @param {'global' | 'project'} scope
 * @returns {string}
 */
export function getClaudeMcpPath(scope = 'project') {
  if (scope === 'global') {
    return path.join(os.homedir(), '.claude.json');
  }
  return path.join(process.cwd(), '.mcp.json');
}

export async function installClaude({
  token,
  pluginRef,
  version,
  mcpGroup,
  skills,
  rules,
  mcp = {},
  scope,
  host,
  installMcp,
  installSkillsRules,
  manageSkills = false,
  manageRules = false,
  installedSkillIds = [],
  installedRuleIds = [],
}) {
  // Bake this install's version + refresh command into the self-update rule (option B).
  rules = applySelfUpdateTemplate(rules, { version, agent: 'claude', ref: pluginRef, scope });
  const claudeHome = path.join(os.homedir(), '.claude');
  const baseDir = scope === 'global' ? claudeHome : path.join(process.cwd(), '.claude');
  const skillsDir = path.join(baseDir, 'skills');
  const rulesDir = path.join(baseDir, 'rules');
  const mcpPath = getClaudeMcpPath(scope);

  console.log(chalk.bold('  ▶  Installing for Claude Code...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = mcp;
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(path.dirname(mcpPath));
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      config.mcpServers['weegloo'] = {
        type: 'http',
        url: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
      };
      const { command, args, env } = uploadServerCommand({ injectPath: host === 'xcode' });
      config.mcpServers['weegloo-upload'] = {
        command,
        args,
        env: {
          ...env,
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

  // ── Rules download & install ────────────────────────────────
  if (!installSkillsRules) {
    console.log(chalk.dim('  - Rules: skipped (MCP only)'));
  } else if (rules.length === 0) {
    console.log(chalk.dim('  - Rules: none selected, skipping'));
  } else {
    const rulesSpinner = ora({ text: `  Installing rules (0/${rules.length})`, indent: 0 }).start();
    try {
      ensureDir(rulesDir);
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Installing rules (${i + 1}/${rules.length}) ${chalk.dim(rule.id)}`;
        writeContentFile(path.join(rulesDir, `${rule.id}.md`), rule.content);
      }
      rulesSpinner.succeed(
        `  Rules installed    ${chalk.dim(`(${rules.length})  → ${rulesDir}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
  }

  // Reconcile with the version-check.json record: remove any skill/rule we installed before but
  // are not installing now (deleted upstream OR deselected), rewrite the record, and re-stamp the
  // version check.
  if (installSkillsRules) {
    const { removedSkills, removedRules, stampPath } = syncInstalledRecord({
      scope,
      version,
      manageSkills,
      installedSkillIds,
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules,
      installedRuleIds,
      removeRules: (ids) => removeRuleFiles(rulesDir, ids, 'md'),
    });
    if (removedSkills.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedSkills.length} stale skill(s): ${removedSkills.join(', ')}`));
    }
    if (removedRules.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedRules.length} stale rule(s): ${removedRules.join(', ')}`));
    }
    if (stampPath) console.log(chalk.dim(`  - Version check armed  → ${stampPath}`));
  }

  // ── Next steps ──────────────────────────────────────────────
  console.log();
  console.log(chalk.dim('  💡 Claude Code: add marketplace, then install the plugin:'));
  console.log();
  console.log(
    '     ' +
    chalk.cyan('claude plugin marketplace add') +
    ' ' +
    chalk.white('https://github.com/weeglooapi/weegloo-mcp-plugin')
  );
  console.log(
    '     ' + chalk.cyan('claude plugin install') + ' ' + chalk.white('weegloo@weegloo-plugins')
  );
  console.log();
  console.log(chalk.dim('  Or MCP-only from a local clone (plugin root):'));
  console.log();
  console.log('     ' + chalk.cyan('git clone https://github.com/weeglooapi/weegloo-mcp-plugin.git'));
  console.log(
    '     ' +
    chalk.cyan('claude mcp add-from-claude-plugin') +
    ' ' +
    chalk.white('./weegloo-mcp-plugin/plugins/weegloo')
  );
}
