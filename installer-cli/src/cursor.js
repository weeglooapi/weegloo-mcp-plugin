import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import {
  downloadFile,
  getPluginRef,
  fetchMcpConfig,
  SKILL_FILES,
  PLUGIN_PACKAGE_ROOT,
} from './github.js';

const CURSOR_HOME = path.join(os.homedir(), '.cursor');
const CURSOR_MCP_PATH = path.join(CURSOR_HOME, 'mcp.json');

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

export async function installCursor({ token, pluginRef, mcpGroup, skills, rules, scope, installMcp, installSkillsRules }) {
  const ref = pluginRef ?? getPluginRef();
  const baseDir = scope === 'global' ? CURSOR_HOME : path.join(process.cwd(), '.cursor');
  const skillsDir = path.join(baseDir, 'skills');
  const rulesDir = path.join(baseDir, 'rules');

  console.log(chalk.bold('  ▶  Installing for Cursor...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = await fetchMcpConfig(ref);
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(CURSOR_HOME);
      const config = readJsonSafe(CURSOR_MCP_PATH);
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

      fs.writeFileSync(CURSOR_MCP_PATH, JSON.stringify(config, null, 2), 'utf-8');
      mcpSpinner.succeed(
        `  MCP servers configured  ${chalk.dim('→ ' + CURSOR_MCP_PATH)}`
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
    const skillsSpinner = ora({ text: `  Downloading skills (0/${skills.length})`, indent: 0 }).start();
    try {
      ensureDir(skillsDir);
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillsSpinner.text = `  Downloading skills (${i + 1}/${skills.length}) ${chalk.dim(skill)}`;
        const destDir = path.join(skillsDir, skill);
        for (const file of SKILL_FILES) {
          await downloadFile(ref, `${PLUGIN_PACKAGE_ROOT}/skills/${skill}/${file}`, path.join(destDir, file));
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
    const rulesSpinner = ora({ text: `  Downloading rules (0/${rules.length})`, indent: 0 }).start();
    try {
      ensureDir(rulesDir);
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Downloading rules (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
        await downloadFile(ref, `${PLUGIN_PACKAGE_ROOT}/rules/${rule}.mdc`, path.join(rulesDir, `${rule}.mdc`));
      }
      rulesSpinner.succeed(
        `  Rules installed    ${chalk.dim(`(${rules.length})  → ${rulesDir}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Cursor or connect the weegloo server from the MCP tab.'));
}
