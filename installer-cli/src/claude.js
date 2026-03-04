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

export async function installClaude({ token, mcpGroup, skills, rules }) {
  const ref = getPluginRef();

  console.log(chalk.bold('  ▶  Claude Code 설치 중...'));
  console.log(chalk.dim(`     github: weeglooapi/weegloo-mcp-plugin @ ${chalk.cyan(ref)}`));
  console.log();

  // ── .mcp.json 설정 ─────────────────────────────────────────
  const mcpSpinner = ora({ text: '  MCP 서버 설정 중', indent: 0 }).start();
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
      `  MCP 서버 설정 완료  ${chalk.dim('→ ' + mcpPath)}`
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
      const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      ensureDir(claudeSkillsDir);
      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillsSpinner.text = `  Skills 다운로드 중 (${i + 1}/${skills.length}) ${chalk.dim(skill)}`;
        const destDir = path.join(claudeSkillsDir, skill);
        for (const file of SKILL_FILES) {
          await downloadFile(ref, `skills/${skill}/${file}`, path.join(destDir, file));
        }
      }
      skillsSpinner.succeed(
        `  Skills 설치 완료   ${chalk.dim(`(${skills.length})  → ${path.join(os.homedir(), '.claude', 'skills')}`)}`
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
      const rulesDir = path.join(process.cwd(), '.claude', 'rules');
      ensureDir(rulesDir);
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Rules 다운로드 중 (${i + 1}/${rules.length}) ${chalk.dim(rule)}`;
        await downloadFile(ref, `rules/${rule}.mdc`, path.join(rulesDir, `${rule}.mdc`));
      }
      rulesSpinner.succeed(
        `  Rules 설치 완료    ${chalk.dim(`(${rules.length})  → ${path.join(process.cwd(), '.claude', 'rules')}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Rules 설치 실패: ${err.message}`);
    }
  }

  // ── 다음 단계 안내 ─────────────────────────────────────────
  console.log();
  console.log(chalk.dim('  💡 Claude Code 플러그인을 활성화하려면 아래 명령을 실행하세요:'));
  console.log();
  console.log(
    '     ' +
    chalk.cyan('claude mcp add-from-claude-plugin') +
    ' ' +
    chalk.white('https://github.com/weeglooapi/weegloo-mcp-plugin')
  );
  console.log();
  console.log(chalk.dim('  또는 로컬 클론 후:'));
  console.log();
  console.log('     ' + chalk.cyan('git clone https://github.com/weeglooapi/weegloo-mcp-plugin.git'));
  console.log('     ' + chalk.cyan('claude mcp add-from-claude-plugin ./weegloo-mcp-plugin'));
}
