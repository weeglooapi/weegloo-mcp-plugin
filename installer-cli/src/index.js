import { select, checkbox, password } from '@inquirer/prompts';
import chalk from 'chalk';
import { installCursor } from './cursor.js';
import { installClaude } from './claude.js';

const SKILL_CHOICES = [
  {
    name: `${chalk.bold('weegloo-create-content-type')}  ${chalk.dim('Skill for creating ContentType')}`,
    value: 'weegloo-create-content-type',
    checked: true,
  },
  {
    name: `${chalk.bold('weegloo-web-hosting')}          ${chalk.dim('Skill for deploying web projects')}`,
    value: 'weegloo-web-hosting',
    checked: true,
  },
];

const RULE_CHOICES = [
  {
    name: `${chalk.bold('weegloo-global-rules')}         ${chalk.dim('Global MCP rules')}`,
    value: 'weegloo-global-rules',
    checked: true,
  },
  {
    name: `${chalk.bold('weegloo-web-hosting-rules')}    ${chalk.dim('Web hosting specific rules')}`,
    value: 'weegloo-web-hosting-rules',
    checked: true,
  },
];

const MCP_GROUP_CHOICES = [
  {
    name: `${chalk.bold('default')}   ${chalk.dim('Basic tool set (recommended)')}`,
    value: '',
  },
  {
    name: `${chalk.bold('core')}      ${chalk.dim('Basic tools, excluding WebHosting and Tokens')}`,
    value: 'core',
  },
  {
    name: `${chalk.bold('extra')}     ${chalk.dim('Adds Usage, Webhooks, Tags, and Limits tools')}`,
    value: 'extra',
  },
  {
    name: `${chalk.bold('all')}       ${chalk.dim('All tools in a single server')}`,
    value: 'all',
  },
];

function printBanner() {
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
  console.log(chalk.dim('  Sets up the Weegloo MCP plugin for your IDE.'));
  console.log(chalk.dim('  Configures MCP servers, Skills, and Rules automatically.'));
  console.log();
}

async function main() {
  printBanner();

  const ide = await select({
    message: 'Select your IDE:',
    choices: [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Claude Code', value: 'claude' },
      { name: 'Both (Cursor + Claude Code)', value: 'both' },
    ],
  });

  const token = await password({
    message: 'Enter your Weegloo Personal Access Token:',
    mask: '*',
  });

  if (!token || token.trim().length === 0) {
    console.log();
    console.log(chalk.red('  ✖  Personal Access Token is required.'));
    console.log(
      chalk.dim('     Generate one from the Weegloo console: ') +
      chalk.cyan('https://console.weegloo.com')
    );
    console.log();
    process.exit(1);
  }

  const mcpGroup = await select({
    message: 'Select the MCP server group:',
    choices: MCP_GROUP_CHOICES,
  });

  const skills = await checkbox({
    message: 'Select skills to install:',
    choices: SKILL_CHOICES,
  });

  const rules = await checkbox({
    message: 'Select rules to install:',
    choices: RULE_CHOICES,
  });

  const scope = (skills.length > 0 || rules.length > 0)
    ? await select({
        message: 'Where would you like to install Skills / Rules?',
        choices: [
          {
            name: `Global  ${chalk.dim('~/.cursor/  (applies to all projects)')}`,
            value: 'global',
          },
          {
            name: `Project  ${chalk.dim('.cursor/  (applies to this project only)')}`,
            value: 'project',
          },
        ],
      })
    : 'global';

  console.log();

  const answers = {
    ide,
    token: token.trim(),
    mcpGroup,
    skills,
    rules,
    scope,
  };

  if (ide === 'cursor' || ide === 'both') {
    await installCursor(answers);
  }

  if (ide === 'claude' || ide === 'both') {
    await installClaude(answers);
  }

  console.log();
  console.log(chalk.bold.green('  ✔  Installation complete!'));
  console.log();
  console.log(
    '  ' + chalk.dim('Docs: ') + chalk.cyan('https://docs.weegloo.com/mcp-server/')
  );
  console.log();
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log();
    console.log(chalk.yellow('  Installation cancelled.'));
    console.log();
    process.exit(0);
  }
  console.error();
  console.error(chalk.red('  Error: ') + err.message);
  console.error();
  process.exit(1);
});
