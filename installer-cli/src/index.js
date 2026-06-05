import { select, checkbox, password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { getPluginRef, fetchBranches, fetchReleaseVersions, fetchResourceLists } from './github.js';
import { installCursor } from './cursor.js';
import { installClaude } from './claude.js';
import { installAntigravity } from './antigravity.js';
import { installCodex, handleCodexMcpLogin } from './codex.js';

const PAT_GENERATION_URL = 'https://console.weegloo.com/account/profile/personal-access-tokens';

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

  // 1. Select plugin version (branch) - first
  let pluginRef = getPluginRef();
  const refFromEnvOrArg = process.argv.includes('--ref') || process.env.WEEGLOO_REF;
  const showAllBranches =
    process.argv.includes('-a') || process.argv.includes('--all-branches');
  if (!refFromEnvOrArg) {
    const branchSpinner = ora({ text: '  Fetching plugin versions...', indent: 0 }).start();
    let sorted;
    if (showAllBranches) {
      // Internal/debug path (-a): list every branch incl. develop via the API.
      const branches = await fetchBranches({ includeHidden: true });
      const parseVersion = (s) => {
        const m = String(s).replace(/^v/, '').match(/^(\d+(?:\.\d+)*)/);
        if (!m) return null;
        return m[1].split('.').map(Number);
      };
      const compareVersion = (a, b) => {
        const aVer = parseVersion(a);
        const bVer = parseVersion(b);
        for (let i = 0; i < Math.max(aVer?.length ?? 0, bVer?.length ?? 0); i++) {
          const x = aVer?.[i] ?? 0;
          const y = bVer?.[i] ?? 0;
          if (x !== y) return y - x;
        }
        return String(a).localeCompare(String(b));
      };
      const latestOnly = branches.filter((b) => b === 'latest');
      const versionBranches = branches
        .filter((b) => b !== 'latest' && parseVersion(b))
        .sort(compareVersion)
        .slice(0, 5);
      const rest = branches
        .filter((b) => b !== 'latest' && !parseVersion(b))
        .sort((a, b) => a.localeCompare(b));
      sorted = [...latestOnly, ...versionBranches, ...rest];
    } else {
      // Default path: 'latest' + recent release tags from the static atom feed
      // (no api.github.com). 'latest' resolves to the latest GitHub Release.
      const versions = await fetchReleaseVersions();
      sorted = ['latest', ...versions.slice(0, 5)];
    }
    branchSpinner.stop();
    if (sorted.length > 1) {
      pluginRef = await select({
        message: 'Select plugin version:',
        choices: sorted.map((name) => ({
          name: name === 'latest' ? `${chalk.bold(name)}  ${chalk.dim('(recommended)')}` : name,
          value: name,
        })),
      });
    }
  }

  // 2. IDE
  const ide = await select({
    message: 'Select your IDE:',
    choices: [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Claude Code', value: 'claude' },
      { name: 'Antigravity', value: 'antigravity' },
      { name: 'Codex', value: 'codex' },
    ],
  });

  // 3. Checkbox: what to install?
  const installOptions = await checkbox({
    message: 'What would you like to install?',
    choices: [
      {
        name: `Install MCP server  ${chalk.dim('(weegloo, weegloo-upload)')}`,
        value: 'mcp',
        checked: true,
      },
      {
        name: `Install Skills and Rules  ${chalk.dim('(from selected branch)')}`,
        value: 'skillsRules',
        checked: true,
      },
    ],
  });

  const installMcp = installOptions.includes('mcp');
  const installSkillsRules = installOptions.includes('skillsRules');

  if (!installMcp && !installSkillsRules) {
    console.log();
    console.log(chalk.red('  ✖  Select at least one option.'));
    console.log();
    process.exit(1);
  }

  let token = '';
  let mcpGroup = '';
  let scope = 'project';
  let skills = [];
  let rules = [];
  /** '' = legacy repo root; 'plugins/weegloo' = nested marketplace layout */
  let repoContentPrefix = '';

  if (installMcp) {
    console.log(
      chalk.dim('  Generate one at: ') +
      chalk.cyan(PAT_GENERATION_URL)
    );
    token = await password({
      message: 'Enter your Weegloo Personal Access Token:',
      mask: '*',
    });
    if (!token || token.trim().length === 0) {
      console.log();
      console.log(chalk.red('  ✖  Personal Access Token is required for MCP server.'));
      console.log(
        chalk.dim('     Generate one from the Weegloo console: ') +
        chalk.cyan(PAT_GENERATION_URL)
      );
      console.log();
      process.exit(1);
    }
    token = token.trim();
    mcpGroup = await select({
      message: 'Select the MCP server group:',
      choices: MCP_GROUP_CHOICES,
    });
  }

  const needsScopePrompt =
    installSkillsRules ||
    ((ide === 'codex' || ide === 'cursor' || ide === 'claude') && installMcp);
  if (needsScopePrompt) {
    const scopeMessages = {
      codex: 'Where would you like to install Codex configuration (MCP / skills / rules)?',
      cursor: 'Where would you like to install Cursor configuration (MCP / skills / rules)?',
      claude: 'Where would you like to install Claude Code configuration (MCP / skills / rules)?',
    };
    const projectHints = {
      codex: '(./.codex/ in current folder)',
      cursor: '(./.cursor/ in current folder)',
      claude: '(./.mcp.json and ./.claude/ in current folder)',
    };
    const globalHints = {
      codex: '(~/.codex/)',
      cursor: '(Cursor app data mcp.json)',
      claude: '(~/.claude.json)',
    };
    const ideKey = ide === 'codex' || ide === 'cursor' || ide === 'claude' ? ide : null;

    scope = await select({
      message: ideKey ? scopeMessages[ideKey] : 'Where would you like to install Skills / Rules?',
      default: 'project',
      choices: [
        {
          name: ideKey
            ? `Project  ${chalk.dim(projectHints[ideKey])}`
            : `Project  ${chalk.dim('(applies to this project only)')}`,
          value: 'project',
        },
        {
          name: ideKey
            ? `Global  ${chalk.dim(globalHints[ideKey])}`
            : `Global  ${chalk.dim('(applies to all projects)')}`,
          value: 'global',
        },
      ],
    });
  }

  if (installSkillsRules) {
    const resourceSpinner = ora({ text: '  Fetching skills and rules from branch...', indent: 0 }).start();
    const { skills: skillIds, rules: ruleIds, repoContentPrefix: layoutPrefix } =
      await fetchResourceLists(pluginRef);
    repoContentPrefix = layoutPrefix;
    resourceSpinner.stop();

    const skillChoices = skillIds.map((id) => ({ name: chalk.bold(id), value: id, checked: true }));
    const ruleChoices = ruleIds.map((id) => ({ name: chalk.bold(id), value: id, checked: true }));

    skills = await checkbox({
      message: 'Select skills to install:',
      choices: skillChoices,
    });

    rules = await checkbox({
      message: 'Select rules to install:',
      choices: ruleChoices,
    });
  }

  console.log();

  const answers = {
    token: installMcp ? token : undefined,
    pluginRef,
    mcpGroup,
    skills,
    rules,
    repoContentPrefix,
    scope,
    installMcp,
    installSkillsRules,
  };

  if (ide === 'cursor') {
    await installCursor(answers);
  } else if (ide === 'claude') {
    await installClaude(answers);
  } else if (ide === 'antigravity') {
    await installAntigravity(answers);
  } else if (ide === 'codex') {
    await installCodex(answers);
  }

  console.log();
  console.log(chalk.bold.green('  ✔  Installation complete!'));
  console.log();
  if (installMcp && ide !== 'codex') {
    console.log(chalk.bgYellow.black.bold('  ⚠  IMPORTANT  '));
    console.log(
      chalk.yellow.bold('  The weegloo MCP server requires login/authentication.')
    );
    console.log(
      chalk.yellow('  Use the ') +
      chalk.yellow.bold('[Connect]') +
      chalk.yellow(' button in your IDE\'s MCP settings to sign in.')
    );
    console.log();
  } else if (installMcp && ide === 'codex') {
    await handleCodexMcpLogin();
  }
  console.log(
    '  ' + chalk.dim('Docs: ') + chalk.cyan('https://docs.weegloo.com/ai/tools/mcp')
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
