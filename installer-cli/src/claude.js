import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { getPluginRef, fetchMcpConfig, SKILL_FILES } from './github.js';
import { prepareResourceSource } from './resources.js';

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
  mcpGroup,
  skills,
  rules,
  repoContentPrefix = '',
  scope,
  installMcp,
  installSkillsRules,
}) {
  const ref = pluginRef ?? getPluginRef();
  const claudeHome = path.join(os.homedir(), '.claude');
  const baseDir = scope === 'global' ? claudeHome : path.join(process.cwd(), '.claude');
  const skillsDir = path.join(baseDir, 'skills');
  const rulesDir = path.join(baseDir, 'rules');
  const mcpPath = getClaudeMcpPath(scope);

  console.log(chalk.bold('  ▶  Installing for Claude Code...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = await fetchMcpConfig(ref);
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(path.dirname(mcpPath));
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      config.mcpServers['weegloo'] = {
        type: 'http',
        url: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
      };
      config.mcpServers['weegloo-upload'] = {
        command: 'npx',
        args: ['-y', 'weegloo-upload'],
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

  // ── Resolve resource source (release bundle, or per-file fallback) ──
  let source = null;
  if (installSkillsRules && (skills.length > 0 || rules.length > 0)) {
    const prepSpinner = ora({ text: '  Preparing resources', indent: 0 }).start();
    source = await prepareResourceSource({ ref, repoContentPrefix });
    prepSpinner.succeed(
      source.mode === 'bundle'
        ? `  Resources ready    ${chalk.dim('(release bundle)')}`
        : `  Resources ready    ${chalk.dim('(per-file download)')}`
    );
  }

  // ── Skills install ──────────────────────────────────────────
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
        skillsSpinner.text = `  Installing skills (${i + 1}/${skills.length}) ${chalk.dim(skill)}`;
        const destDir = path.join(skillsDir, skill);
        ensureDir(destDir);
        for (const file of SKILL_FILES) {
          const text = await source.getSkillFile(skill, file);
          fs.writeFileSync(path.join(destDir, file), text, 'utf-8');
        }
      }
      skillsSpinner.succeed(
        `  Skills installed   ${chalk.dim(`(${skills.length})  → ${skillsDir}`)}`
      );
    } catch (err) {
      skillsSpinner.fail(`  Failed to install skills: ${err.message}`);
    }
  }

  // ── Rules install ───────────────────────────────────────────
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
        rulesSpinner.text = `  Installing rules (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
        const text = await source.getRuleText(rule);
        fs.writeFileSync(path.join(rulesDir, `${rule}.md`), text, 'utf-8');
      }
      rulesSpinner.succeed(
        `  Rules installed    ${chalk.dim(`(${rules.length})  → ${rulesDir}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
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
