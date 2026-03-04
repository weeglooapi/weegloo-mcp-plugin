import { select, checkbox, password } from '@inquirer/prompts';
import chalk from 'chalk';
import { installCursor } from './cursor.js';
import { installClaude } from './claude.js';

const SKILL_CHOICES = [
  {
    name: `${chalk.bold('weegloo-create-content-type')}  ${chalk.dim('ContentType 생성 스킬')}`,
    value: 'weegloo-create-content-type',
    checked: true,
  },
  {
    name: `${chalk.bold('weegloo-web-hosting')}          ${chalk.dim('웹 프로젝트 배포 스킬')}`,
    value: 'weegloo-web-hosting',
    checked: true,
  },
];

const RULE_CHOICES = [
  {
    name: `${chalk.bold('weegloo-global-rules')}         ${chalk.dim('MCP 전역 규칙')}`,
    value: 'weegloo-global-rules',
    checked: true,
  },
  {
    name: `${chalk.bold('weegloo-web-hosting-rules')}    ${chalk.dim('웹 호스팅 전용 규칙')}`,
    value: 'weegloo-web-hosting-rules',
    checked: true,
  },
];

const MCP_GROUP_CHOICES = [
  {
    name: `${chalk.bold('default')}   ${chalk.dim('기본 도구 세트 (권장)')}`,
    value: '',
  },
  {
    name: `${chalk.bold('core')}      ${chalk.dim('기본 도구 (WebHosting, Tokens 제외)')}`,
    value: 'core',
  },
  {
    name: `${chalk.bold('extra')}     ${chalk.dim('Usage, Webhooks, Tags, Limits 도구 추가')}`,
    value: 'extra',
  },
  {
    name: `${chalk.bold('all')}       ${chalk.dim('모든 도구 (단일 서버로 통합)')}`,
    value: 'all',
  },
];

function printBanner() {
  const line = chalk.bold.cyan('─'.repeat(50));
  console.log();
  console.log(chalk.bold.cyan('  ┌' + '─'.repeat(48) + '┐'));
  console.log(
    chalk.bold.cyan('  │') +
    chalk.bold('  🌊  Weegloo MCP Plugin Installer' + ' '.repeat(13)) +
    chalk.bold.cyan('│')
  );
  console.log(
    chalk.bold.cyan('  │') +
    chalk.dim('     https://weegloo.com' + ' '.repeat(24)) +
    chalk.bold.cyan('│')
  );
  console.log(chalk.bold.cyan('  └' + '─'.repeat(48) + '┘'));
  console.log();
  console.log(chalk.dim('  Weegloo MCP 플러그인을 IDE에 설치합니다.'));
  console.log(chalk.dim('  MCP 서버, Skills, Rules 를 자동으로 구성합니다.'));
  console.log();
}

async function main() {
  printBanner();

  const ide = await select({
    message: 'IDE를 선택하세요:',
    choices: [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Claude Code', value: 'claude' },
      { name: 'Both (Cursor + Claude Code)', value: 'both' },
    ],
  });

  const token = await password({
    message: 'Weegloo Personal Access Token을 입력하세요:',
    mask: '*',
  });

  if (!token || token.trim().length === 0) {
    console.log();
    console.log(chalk.red('  ✖  Personal Access Token은 필수입니다.'));
    console.log(
      chalk.dim('     Weegloo 콘솔에서 토큰을 발급받으세요: ') +
      chalk.cyan('https://console.weegloo.com')
    );
    console.log();
    process.exit(1);
  }

  const mcpGroup = await select({
    message: 'MCP 서버 그룹을 선택하세요:',
    choices: MCP_GROUP_CHOICES,
  });

  const skills = await checkbox({
    message: 'Skills를 선택하세요:',
    choices: SKILL_CHOICES,
  });

  const rules = await checkbox({
    message: 'Rules를 선택하세요:',
    choices: RULE_CHOICES,
  });

  console.log();

  const answers = {
    ide,
    token: token.trim(),
    mcpGroup,
    skills,
    rules,
  };

  if (ide === 'cursor' || ide === 'both') {
    await installCursor(answers);
  }

  if (ide === 'claude' || ide === 'both') {
    await installClaude(answers);
  }

  console.log();
  console.log(chalk.bold.green('  ✔  설치 완료!'));
  console.log();
  console.log(
    '  ' + chalk.dim('문서: ') + chalk.cyan('https://docs.weegloo.com/mcp-server/')
  );
  console.log();
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log();
    console.log(chalk.yellow('  설치가 취소되었습니다.'));
    console.log();
    process.exit(0);
  }
  console.error();
  console.error(chalk.red('  오류: ') + err.message);
  console.error();
  process.exit(1);
});
