import { select, checkbox, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { getPluginRef, fetchBranches } from './github.js';
import { installCursor } from './cursor.js';
import { installClaude } from './claude.js';
import { installAntigravity } from './antigravity.js';

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
    chalk.bold('  🌊  Weegloo MCP Plugin Installer' + ' '.repeat(14)) +
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

  // Plugin version (branch): use --ref / WEEGLOO_REF if set, else show branch picker
  let pluginRef = getPluginRef();
  const refFromEnvOrArg = process.argv.includes('--ref') || process.env.WEEGLOO_REF;
  if (!refFromEnvOrArg) {
    const branchSpinner = ora({ text: '  Fetching plugin versions...', indent: 0 }).start();
    const branches = await fetchBranches();
    branchSpinner.stop();
    if (branches.length > 0) {
      const parseVersion = (s) => {
        const m = String(s).replace(/^v/, '').match(/^(\d+(?:\.\d+)*)/);
        if (!m) return null;
        return m[1].split('.').map(Number);
      };
      const compareVersion = (a, b) => {
        const aVer = parseVersion(a);
        const bVer = parseVersion(b);
        for (let i = 0; i < Math.max(aVer.length, bVer.length); i++) {
          const x = aVer[i] ?? 0;
          const y = bVer[i] ?? 0;
          if (x !== y) return y - x;
        }
        return a.localeCompare(b);
      };
      const latestOnly = branches.filter((b) => b === 'latest');
      const versionBranches = branches
        .filter((b) => b !== 'latest' && parseVersion(b))
        .sort(compareVersion)
        .slice(0, 5);
      const rest = branches
        .filter((b) => b !== 'latest' && !parseVersion(b))
        .sort((a, b) => a.localeCompare(b));
      const sorted = [...latestOnly, ...versionBranches, ...rest];
      pluginRef = await select({
        message: 'Select plugin version (branch):',
        choices: sorted.map((name) => ({
          name: name === 'latest' ? `${chalk.bold(name)}  ${chalk.dim('(recommended)')}` : name,
          value: name,
        })),
      });
    }
  }

  const scope = await select({
    message: 'Where would you like to install Skills / Rules?',
    choices: [
      {
        name: `Global  ${chalk.dim('(applies to all projects)')}`,
        value: 'global',
      },
      {
        name: `Project  ${chalk.dim('(applies to this project only)')}`,
        value: 'project',
      },
    ],
  });

  const ide = await select({
    message: 'Select your IDE:',
    choices: [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Claude Code', value: 'claude' },
      { name: 'Antigravity', value: 'antigravity' },
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

  console.log();

  const answers = {
    token: token.trim(),
    pluginRef,
    mcpGroup,
    skills,
    rules,
    scope,
  };

  if (ide === 'cursor') {
    await installCursor(answers);
  } else if (ide === 'claude') {
    await installClaude(answers);
  } else if (ide === 'antigravity') {
    await installAntigravity(answers);
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
