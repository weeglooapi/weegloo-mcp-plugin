import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { downloadFile, getPluginRef, SKILL_FILES } from './github.js';

const CURSOR_HOME = path.join(os.homedir(), '.cursor');
const CURSOR_MCP_PATH = path.join(CURSOR_HOME, 'mcp.json');
const CURSOR_SKILLS_DIR = path.join(CURSOR_HOME, 'skills');

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

export async function installCursor({ token, mcpGroup, skills, rules }) {
  const ref = getPluginRef();

  console.log(chalk.bold('  ▶  Cursor 설치 중...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  // ── MCP 서버 설정 ──────────────────────────────────────────
  const mcpSpinner = ora({ text: '  MCP 서버 설정 중', indent: 0 }).start();
  try {
    ensureDir(CURSOR_HOME);
    const config = readJsonSafe(CURSOR_MCP_PATH);
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

    fs.writeFileSync(CURSOR_MCP_PATH, JSON.stringify(config, null, 2), 'utf-8');
    mcpSpinner.succeed(
      `  MCP 서버 설정 완료  ${chalk.dim('→ ' + CURSOR_MCP_PATH)}`
    );
  } catch (err) {
    mcpSpinner.fail(`  MCP 서버 설정 실패: ${err.message}`);
  }

  // ── Skills 다운로드 & 설치 ─────────────────────────────────
  if (skills.length === 0) {
    console.log(chalk.dim('  - Skills: 선택 없음, 건너뜀'));
  } else {
    const skillsSpinner = ora({ text: `  Skills 다운로드 중 (0/${skills.length})`, indent: 0 }).start();
    try {
      ensureDir(CURSOR_SKILLS_DIR);
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillsSpinner.text = `  Skills 다운로드 중 (${i + 1}/${skills.length}) ${chalk.dim(skill)}`;
        const destDir = path.join(CURSOR_SKILLS_DIR, skill);
        for (const file of SKILL_FILES) {
          await downloadFile(ref, `skills/${skill}/${file}`, path.join(destDir, file));
        }
      }
      skillsSpinner.succeed(
        `  Skills 설치 완료   ${chalk.dim(`(${skills.length})  → ${CURSOR_SKILLS_DIR}`)}`
      );
    } catch (err) {
      skillsSpinner.fail(`  Skills 설치 실패: ${err.message}`);
    }
  }

  // ── Rules 다운로드 & 설치 ──────────────────────────────────
  if (rules.length === 0) {
    console.log(chalk.dim('  - Rules: 선택 없음, 건너뜀'));
  } else {
    const rulesSpinner = ora({ text: `  Rules 다운로드 중 (0/${rules.length})`, indent: 0 }).start();
    try {
      const rulesDestDir = path.join(process.cwd(), '.cursor', 'rules');
      ensureDir(rulesDestDir);
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Rules 다운로드 중 (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
        await downloadFile(ref, `rules/${rule}.mdc`, path.join(rulesDestDir, `${rule}.mdc`));
      }
      rulesSpinner.succeed(
        `  Rules 설치 완료    ${chalk.dim(`(${rules.length})  → ${path.join(process.cwd(), '.cursor', 'rules')}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Rules 설치 실패: ${err.message}`);
    }
  }

  console.log();
  console.log(chalk.dim('  💡 Cursor를 재시작하거나 MCP 탭에서 weegloo 서버를 연결하세요.'));
}
