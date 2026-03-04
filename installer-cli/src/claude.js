import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { downloadFile, getPluginRef, SKILL_FILES } from './github.js';

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

function buildMcpUrl(group) {
  return group ? `https://ai.weegloo.com/mcp?group=${group}` : 'https://ai.weegloo.com/mcp';
}

export async function installClaude({ token, mcpGroup, skills, rules, scope }) {
  const ref = getPluginRef();
  const claudeHome = path.join(os.homedir(), '.claude');
  const baseDir = scope === 'global' ? claudeHome : path.join(process.cwd(), '.claude');
  const skillsDir = path.join(baseDir, 'skills');
  const rulesDir = path.join(baseDir, 'rules');

  console.log(chalk.bold('  ▶  Installing for Claude Code...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  // ── .mcp.json configuration ─────────────────────────────────
  const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
  const mcpPath = path.join(process.cwd(), '.mcp.json');
  try {
    const config = readJsonSafe(mcpPath);
    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers['weegloo'] = {
      type: 'http',
      url: buildMcpUrl(mcpGroup),
    };
    config.mcpServers['weegloo-upload'] = {
      command: 'npx',
      args: ['-y', 'weegloo-upload'],
      env: {
        UPLOAD_API_URL: 'https://upload.weegloo.com/v1',
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

  // ── Skills download & install ───────────────────────────────
  if (skills.length === 0) {
    console.log(chalk.dim('  - Skills: none selected, skipping'));
  } else {
    const skillsSpinner = ora({ text: `  Downloading skills (0/${skills.length})`, indent: 0 }).start();
    try {
      ensureDir(skillsDir);
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillsSpinner.text = `  Downloading skills (${i + 1}/${skills.length}) ${chalk.dim(skill)}`;
        const destDir = path.join(skillsDir, skill);
        for (const file of SKILL_FILES) {
          await downloadFile(ref, `skills/${skill}/${file}`, path.join(destDir, file));
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
  if (rules.length === 0) {
    console.log(chalk.dim('  - Rules: none selected, skipping'));
  } else {
    const rulesSpinner = ora({ text: `  Downloading rules (0/${rules.length})`, indent: 0 }).start();
    try {
      ensureDir(rulesDir);
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Downloading rules (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
        await downloadFile(ref, `rules/${rule}.mdc`, path.join(rulesDir, `${rule}.mdc`));
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
  console.log(chalk.dim('  💡 To activate the Claude Code plugin, run:'));
  console.log();
  console.log(
    '     ' +
    chalk.cyan('claude mcp add-from-claude-plugin') +
    ' ' +
    chalk.white('https://github.com/weeglooapi/weegloo-mcp-plugin')
  );
  console.log();
  console.log(chalk.dim('  Or clone locally first:'));
  console.log();
  console.log('     ' + chalk.cyan('git clone https://github.com/weeglooapi/weegloo-mcp-plugin.git'));
  console.log('     ' + chalk.cyan('claude mcp add-from-claude-plugin ./weegloo-mcp-plugin'));
}
