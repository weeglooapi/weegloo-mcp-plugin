import { select, checkbox, password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { PKG_PLUGIN_REF, listBranches, loadResources } from './github.js';
import { orderBranchesForPicker } from './versions.js';
import { parseCliArgs, resolveConfig, HELP_TEXT } from './cli.js';
import { installCursor } from './cursor.js';
import { installClaude } from './claude.js';
import { installAntigravity } from './antigravity.js';
import { installAndroidStudio } from './androidstudio.js';
import { installCodex, handleCodexMcpLogin, printCodexLoginNotice } from './codex.js';
import { validateToken, cmaMeUrl } from './validate-token.js';

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

/**
 * Resolves a Personal Access Token that is verified against CMA `GET /v1/me` (must
 * return 200). A token supplied via --token / WEEGLOO_TOKEN is checked once; a token
 * typed at the prompt is re-asked until it verifies. Returns the verified token.
 *
 * Failure handling: a definitive rejection (non-200) re-prompts interactively, or fails
 * fast in non-interactive mode (never writes a known-bad token to config). A network
 * error (couldn't reach CMA) re-prompts interactively, but in non-interactive mode it
 * proceeds with a warning — the token can't be confirmed either way and blocking a piped
 * install on a transient network fault would be worse than the prior no-check behavior.
 *
 * @param {{ providedToken: string|null, meUrl: string, nonInteractive: boolean }} args
 * @returns {Promise<string>}
 */
async function resolveValidToken({ providedToken, meUrl, nonInteractive }) {
  const verify = async (tok) => {
    const spinner = ora({ text: '  Verifying token...', indent: 0 }).start();
    const result = await validateToken(tok, { meUrl });
    if (result.ok) {
      spinner.succeed('  Token verified');
    } else if (result.networkError) {
      spinner.fail('  Could not reach Weegloo to verify the token.');
    } else {
      spinner.fail(`  Invalid Personal Access Token (server responded ${result.status}).`);
    }
    return result;
  };

  // 1) Token pinned via --token / WEEGLOO_TOKEN — verify it once.
  if (providedToken != null) {
    const result = await verify(providedToken);
    if (result.ok) return providedToken;
    if (nonInteractive) {
      if (result.networkError) {
        console.log(
          chalk.yellow('  ⚠  ') +
          chalk.dim('Proceeding without verification (network error). The token was NOT confirmed.')
        );
        return providedToken;
      }
      console.log();
      console.log(chalk.red('  ✖  The provided Personal Access Token is invalid.'));
      console.log(
        chalk.dim('     Generate one from the Weegloo console: ') + chalk.cyan(PAT_GENERATION_URL)
      );
      console.log();
      process.exit(1);
    }
    // Interactive: let the user correct the bad/unverifiable token via the prompt below.
    console.log(chalk.dim('  Enter a valid token to continue.'));
  }

  // 2) Interactive prompt — repeat until a token verifies (200) or the user cancels (Ctrl+C).
  console.log(chalk.dim('  Generate one at: ') + chalk.cyan(PAT_GENERATION_URL));
  for (;;) {
    const entered = await password({
      message: 'Enter your Weegloo Personal Access Token:',
      mask: '*',
    });
    const token = (entered || '').trim();
    if (!token) {
      console.log(chalk.red('  ✖  Personal Access Token is required for MCP server.'));
      continue;
    }
    const result = await verify(token);
    if (result.ok) return token;
    console.log(
      result.networkError
        ? chalk.dim('     Check your connection, then re-enter your token.')
        : chalk.dim('     That token was rejected. Please re-enter a valid token.')
    );
  }
}

/**
 * Loud, red, impossible-to-miss banner shown when Android Studio is chosen. Its Gemini is
 * unreliable with Weegloo (AI performance), so we strongly steer users to another agent.
 * The interactive re-confirm lives at the call site; non-interactive runs still print this.
 */
function printAndroidStudioWarning() {
  const W = 64;
  const bar = (text) => {
    const body = ('  ' + text).slice(0, W);
    return chalk.bgRed.white.bold(body + ' '.repeat(Math.max(0, W - body.length)));
  };
  console.log();
  console.log(bar(''));
  console.log(bar('⛔  WARNING — ANDROID STUDIO IS STRONGLY NOT RECOMMENDED'));
  console.log(bar(''));
  console.log(bar("Android Studio's Gemini is highly unstable with Weegloo"));
  console.log(bar('due to AI performance issues. Using a different AI Agent'));
  console.log(bar('(Cursor, Claude Code, Codex, Antigravity) is STRONGLY'));
  console.log(bar('recommended.'));
  console.log(bar(''));
  console.log();
}

async function main() {
  // Parse flags before anything else so --help and parse errors stay clean.
  let values;
  try {
    values = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error();
    console.error(chalk.red('  Error: ') + err.message);
    console.error(chalk.dim('  Run with --help to see available options.'));
    console.error();
    process.exit(1);
  }

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const isTTY = Boolean(process.stdin.isTTY);
  const { errors, warnings, config } = resolveConfig({
    values,
    env: process.env,
    isTTY,
    pkgPluginRef: PKG_PLUGIN_REF,
  });

  printBanner();

  if (errors.length > 0) {
    for (const e of errors) console.log(chalk.red('  ✖  ') + e);
    console.log();
    console.log(chalk.dim('  Run with --help to see available options.'));
    console.log();
    process.exit(1);
  }

  for (const w of warnings) console.log(chalk.yellow('  ⚠  ') + chalk.dim(w));
  if (warnings.length > 0) console.log();

  if (config.nonInteractive) {
    console.log(
      chalk.dim(`  Non-interactive mode${isTTY ? '' : ' (no TTY)'} — using flags + defaults.`)
    );
    console.log();
  }

  // 1. Plugin version (branch). Pinned by flag/env → skip the picker; otherwise
  //    prompt (interactive) or fall back to the baked-in default (non-interactive).
  let pluginRef = config.pluginRef;
  if (pluginRef == null) {
    const branchSpinner = ora({ text: '  Fetching plugin versions...', indent: 0 }).start();
    const branches = await listBranches();
    branchSpinner.stop();
    const sorted = orderBranchesForPicker(branches, { showAll: config.showAllBranches });
    if (sorted.length > 0) {
      pluginRef = await select({
        message: 'Select plugin version (branch):',
        choices: sorted.map((name) => ({
          name: name === 'latest' ? `${chalk.bold(name)}  ${chalk.dim('(recommended)')}` : name,
          value: name,
        })),
      });
    } else {
      pluginRef = PKG_PLUGIN_REF;
    }
  }

  // 2. IDE / agent
  let ide = config.agent;
  if (ide == null) {
    ide = await select({
      message: 'Select your IDE:',
      choices: [
        { name: 'Cursor', value: 'cursor' },
        { name: 'Claude Code', value: 'claude' },
        { name: 'Codex', value: 'codex' },
        { name: 'Antigravity', value: 'antigravity' },
        { name: 'Android Studio', value: 'androidstudio' },
      ],
    });
  }

  // Android Studio (Gemini) is unreliable with Weegloo — warn loudly and, interactively,
  // require an explicit re-confirm (defaulting to "no") before continuing. A pinned,
  // non-interactive choice still sees the warning but is not blocked.
  if (ide === 'androidstudio') {
    printAndroidStudioWarning();
    if (!config.nonInteractive) {
      const proceed = await confirm({
        message: 'Do you still want to install for Android Studio anyway?',
        default: false,
      });
      if (!proceed) {
        console.log();
        console.log(chalk.yellow('  Installation cancelled.'));
        console.log();
        process.exit(0);
      }
    }
  }

  // 3. What to install. Flags pin either toggle; otherwise prompt (the combined
  //    checkbox when both are unknown, to preserve the original UX) or default on.
  let installMcp = config.installMcp;
  let installSkillsRules = config.installSkillsRules;

  if (config.nonInteractive) {
    if (installMcp == null) installMcp = true;
    if (installSkillsRules == null) installSkillsRules = true;
  } else if (installMcp == null && installSkillsRules == null) {
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
    installMcp = installOptions.includes('mcp');
    installSkillsRules = installOptions.includes('skillsRules');
  } else {
    if (installMcp == null) {
      installMcp = await confirm({
        message: 'Install MCP server (weegloo, weegloo-upload)?',
        default: true,
      });
    }
    if (installSkillsRules == null) {
      installSkillsRules = await confirm({ message: 'Install Skills and Rules?', default: true });
    }
  }

  if (!installMcp && !installSkillsRules) {
    console.log();
    console.log(chalk.red('  ✖  Select at least one option.'));
    console.log();
    process.exit(1);
  }

  let token = '';
  let mcpGroup = '';
  let scope = config.scope ?? 'global';
  let skills = [];
  let rules = [];

  // At least one of MCP / skills+rules is selected (guarded above), so the manifest is
  // always needed: one fetch covers skill/rule lists + content + MCP URLs (no api.github.com).
  const resourceSpinner = ora({ text: '  Fetching plugin manifest...', indent: 0 }).start();
  const resources = await loadResources(pluginRef);

  // Fail fast: the manifest is the required source for this version's skills/rules/MCP.
  if (!resources) {
    resourceSpinner.fail(`  Could not fetch the plugin manifest for '${pluginRef}'.`);
    console.error(
      chalk.dim('     Check your network connection, or choose a published version (e.g. latest).')
    );
    process.exit(1);
  }
  resourceSpinner.stop();
  const mcp = resources.mcp;

  if (installMcp) {
    // Token: flag/env pins it; otherwise prompt (interactive). Non-interactive with no
    // token + MCP was already rejected by resolveConfig, so we never block on stdin here.
    // Whichever source it comes from, the token is verified against CMA GET /v1/me (200)
    // before we use it; the prompt re-asks until a token verifies.
    token = await resolveValidToken({
      providedToken: config.token,
      meUrl: cmaMeUrl(mcp),
      nonInteractive: config.nonInteractive,
    });

    // MCP group: --mcp <group> pins it (default ⇒ ''); otherwise prompt or default ''.
    if (config.mcpGroup != null) {
      mcpGroup = config.mcpGroup;
    } else if (!config.nonInteractive) {
      mcpGroup = await select({
        message: 'Select the MCP server group:',
        choices: MCP_GROUP_CHOICES,
      });
    }
  }

  // Android Studio is project-only (no global variant), so it never prompts for scope —
  // it's normalized to 'project' below.
  const needsScopePrompt =
    ide !== 'androidstudio' &&
    (installSkillsRules ||
      ((ide === 'codex' || ide === 'cursor' || ide === 'claude' || ide === 'antigravity') && installMcp));
  if (config.scope == null && needsScopePrompt && !config.nonInteractive) {
    const scopeMessages = {
      codex: 'Where would you like to install Codex configuration (MCP / skills / rules)?',
      cursor: 'Where would you like to install Cursor configuration (MCP / skills / rules)?',
      claude: 'Where would you like to install Claude Code configuration (MCP / skills / rules)?',
      antigravity: 'Where would you like to install Antigravity configuration (MCP / skills / rules)?',
    };
    const projectHints = {
      codex: '(./.codex/ in current folder)',
      cursor: '(./.cursor/ in current folder)',
      claude: '(./.mcp.json and ./.claude/ in current folder)',
      antigravity: '(./.agents/ and ./AGENTS.md in current folder)',
    };
    const globalHints = {
      codex: '(~/.codex/)',
      cursor: '(Cursor app data mcp.json)',
      claude: '(~/.claude.json)',
      antigravity: '(~/.gemini/ — config/mcp_config.json, skills/, GEMINI.md)',
    };
    const ideKey = ['codex', 'cursor', 'claude', 'antigravity'].includes(ide) ? ide : null;

    scope = await select({
      message: ideKey ? scopeMessages[ideKey] : 'Where would you like to install Skills / Rules?',
      default: 'global',
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

  // Android Studio is project-only: skills → ./.android-studio/skills, rules → ./AGENTS.md, and
  // the MCP config goes to Android Studio's own config directory. Normalize scope to 'project'
  // and warn if the user explicitly asked for global.
  if (ide === 'androidstudio') {
    if (config.scope === 'global') {
      console.log(
        chalk.yellow('  ⚠  ') +
        chalk.dim(
          "Android Studio installs are project-only; using the current project (./.android-studio/skills and ./AGENTS.md). MCP goes to Android Studio's config directory."
        )
      );
      console.log();
    }
    scope = 'project';
  }


  if (installSkillsRules) {
    // --ignore-skill / --ignore-rule skip a kind entirely; otherwise install ALL
    // (non-interactive) or let the user pick (interactive). Empty lists are skipped —
    // @inquirer/checkbox throws on zero choices, and a branch may have no skills/rules.
    if (!config.ignoreSkill && resources.skills.length > 0) {
      if (config.nonInteractive) {
        skills = resources.skills;
      } else {
        const chosenSkillIds = await checkbox({
          message: 'Select skills to install:',
          choices: resources.skills.map((s) => ({ name: chalk.bold(s.id), value: s.id, checked: true })),
        });
        skills = resources.skills.filter((s) => chosenSkillIds.includes(s.id));
      }
    }

    if (!config.ignoreRule && resources.rules.length > 0) {
      if (config.nonInteractive) {
        rules = resources.rules;
      } else {
        const chosenRuleIds = await checkbox({
          message: 'Select rules to install:',
          choices: resources.rules.map((r) => ({ name: chalk.bold(r.id), value: r.id, checked: true })),
        });
        rules = resources.rules.filter((r) => chosenRuleIds.includes(r.id));
      }
    }
  }

  console.log();

  const answers = {
    token: installMcp ? token : undefined,
    pluginRef,
    version: resources.version,
    mcpGroup,
    skills,
    rules,
    mcp,
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
  } else if (ide === 'androidstudio') {
    await installAndroidStudio(answers);
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
    // `codex mcp login` is interactive (inherited stdio); never spawn it without a TTY.
    if (config.nonInteractive) {
      printCodexLoginNotice();
    } else {
      await handleCodexMcpLogin();
    }
  }
  console.log(
    '  ' + chalk.dim('Docs: ') + chalk.cyan('https://docs.weegloo.com/en-US/ai/tools/mcp/')
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
