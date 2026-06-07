import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { writeContentFile } from './io.js';

const CURSOR_HOME = path.join(os.homedir(), '.cursor');

/**
 * Cursor global MCP path (official app data location per OS).
 * @returns {string}
 */
export function getCursorGlobalMcpPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'mcp.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'mcp.json');
  }
  return path.join(home, '.config', 'Cursor', 'mcp.json');
}

/**
 * @param {'global' | 'project'} scope
 * @returns {string}
 */
export function getCursorMcpPath(scope = 'project') {
  if (scope === 'global') return getCursorGlobalMcpPath();
  return path.join(process.cwd(), '.cursor', 'mcp.json');
}

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

export async function installCursor({
  token,
  pluginRef,
  mcpGroup,
  skills,
  rules,
  mcp = {},
  scope,
  installMcp,
  installSkillsRules,
}) {
  const baseDir = scope === 'global' ? CURSOR_HOME : path.join(process.cwd(), '.cursor');
  const skillsDir = path.join(baseDir, 'skills');
  const rulesDir = path.join(baseDir, 'rules');
  const mcpPath = getCursorMcpPath(scope);

  console.log(chalk.bold('  ▶  Installing for Cursor...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(pluginRef)}`));
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
        writeContentFile(path.join(rulesDir, `${rule.id}.mdc`), rule.content);
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
