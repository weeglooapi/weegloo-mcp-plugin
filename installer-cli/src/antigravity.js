import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { downloadFile, getPluginRef, SKILL_FILES } from './github.js';

const ANTIGRAVITY_HOME = path.join(os.homedir(), '.gemini', 'antigravity');
const ANTIGRAVITY_MCP_PATH = path.join(ANTIGRAVITY_HOME, 'mcp_config.json');
const GEMINI_MD_PATH = path.join(os.homedir(), '.gemini', 'GEMINI.md');

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

/**
 * Appends rule content to ~/.gemini/GEMINI.md.
 * Skips if the rule's section marker already exists.
 */
function appendToGeminiMd(ruleName, content) {
  const marker = `<!-- weegloo:${ruleName} -->`;
  const existing = fs.existsSync(GEMINI_MD_PATH)
    ? fs.readFileSync(GEMINI_MD_PATH, 'utf-8')
    : '';

  if (existing.includes(marker)) return;

  const section = `\n${marker}\n${content}\n`;
  fs.appendFileSync(GEMINI_MD_PATH, section, 'utf-8');
}

export async function installAntigravity({ token, pluginRef, mcpGroup, skills, rules, scope }) {
  const ref = pluginRef ?? getPluginRef();
  const skillsDir = scope === 'global'
    ? path.join(ANTIGRAVITY_HOME, 'skills')
    : path.join(process.cwd(), '.agent', 'skills');

  console.log(chalk.bold('  ▶  Installing for Antigravity...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  // ── MCP server configuration ────────────────────────────────
  const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
  try {
    ensureDir(ANTIGRAVITY_HOME);
    const config = readJsonSafe(ANTIGRAVITY_MCP_PATH);
    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers['weegloo'] = {
      serverUrl: buildMcpUrl(mcpGroup),
    };
    config.mcpServers['weegloo-upload'] = {
      command: 'npx',
      args: ['-y', 'weegloo-upload'],
      env: {
        UPLOAD_API_URL: 'https://upload.weegloo.com/v1',
        AUTH_BEARER_TOKEN: token,
      },
    };

    fs.writeFileSync(ANTIGRAVITY_MCP_PATH, JSON.stringify(config, null, 2), 'utf-8');
    mcpSpinner.succeed(
      `  MCP servers configured  ${chalk.dim('→ ' + ANTIGRAVITY_MCP_PATH)}`
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
      if (scope === 'global') {
        // Global rules → append to ~/.gemini/GEMINI.md
        ensureDir(path.dirname(GEMINI_MD_PATH));
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          rulesSpinner.text = `  Downloading rules (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
          const tmpPath = path.join(os.tmpdir(), `weegloo-${rule}.md`);
          await downloadFile(ref, `rules/${rule}.mdc`, tmpPath);
          const content = fs.readFileSync(tmpPath, 'utf-8');
          appendToGeminiMd(rule, content);
        }
        rulesSpinner.succeed(
          `  Rules installed    ${chalk.dim(`(${rules.length})  → ${GEMINI_MD_PATH}`)}`
        );
      } else {
        // Project rules → .agent/rules/<rule>.md
        const rulesDir = path.join(process.cwd(), '.agent', 'rules');
        ensureDir(rulesDir);
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          rulesSpinner.text = `  Downloading rules (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
          await downloadFile(ref, `rules/${rule}.mdc`, path.join(rulesDir, `${rule}.md`));
        }
        rulesSpinner.succeed(
          `  Rules installed    ${chalk.dim(`(${rules.length})  → ${path.join(process.cwd(), '.agent', 'rules')}`)}`
        );
      }
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Antigravity to apply the MCP server configuration.'));
}
