import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';
import { writeContentFile } from './io.js';
import { upsertRuleInAgentsMd } from './codex.js';
import { applySelfUpdateTemplate, writeVersionStamp, SELF_UPDATE_RULE_ID } from './self-update.js';

/**
 * Android Studio (Gemini) target.
 *
 * Constraints from the Android Studio MCP docs:
 *  - MCP config lives in `mcp.json` inside Android Studio's (version-specific)
 *    configuration directory. Remote HTTP servers use the `httpUrl` field.
 *  - Android Studio supports ONLY remote HTTP/SSE MCP servers — NOT stdio. So the
 *    local `weegloo-upload` (npx/stdio) server cannot be installed here; only the
 *    remote `weegloo` server is configured. Auth is via the IDE's Connect (OAuth)
 *    button, so no token is written into mcp.json.
 *  - Skills → `.android-studio/skills/<id>/…` (home dir for global, project root for project).
 *  - Rules → `AGENTS.md` (same mechanism Codex uses), so we reuse upsertRuleInAgentsMd.
 */

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

/** The OS-specific parent that holds Android Studio's per-version config directories. */
function androidStudioConfigBase() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Google');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google');
  }
  return path.join(os.homedir(), '.config', 'Google');
}

/**
 * Resolves the Android Studio configuration directory that holds mcp.json.
 * The dir name is version-stamped (e.g. `AndroidStudio2024.3`), so we pick the
 * newest existing `AndroidStudio*` directory. Returns { base, dir, detected }.
 * When none exists yet, `dir` falls back to `<base>/AndroidStudio` and detected=false.
 */
export function resolveAndroidStudioConfigDir() {
  const base = androidStudioConfigBase();
  let detected = null;
  try {
    const dirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^AndroidStudio/i.test(e.name))
      .map((e) => e.name)
      // Newest version first: numeric-aware compare so 2024.3 > 2024.10 is handled sanely.
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (dirs.length > 0) detected = path.join(base, dirs[0]);
  } catch {
    /* base dir doesn't exist — Android Studio not installed / never launched */
  }
  return {
    base,
    dir: detected || path.join(base, 'AndroidStudio'),
    detected: Boolean(detected),
  };
}

export async function installAndroidStudio({
  pluginRef,
  version,
  mcpGroup,
  skills,
  rules,
  mcp = {},
  scope,
  installMcp,
  installSkillsRules,
}) {
  // Android Studio skills are PROJECT-SCOPED ONLY (per the Android skills spec:
  // "Only skills within your project's codebase are supported"). Skills live in
  // `.agent/skills` at the project root; behavioral rules go to the project's
  // AGENTS.md. index.js normalizes `scope` to 'project' for this target, so there
  // is no home/global variant here.
  const skillsDir = path.join(process.cwd(), '.agent', 'skills');
  const agentsPath = path.join(process.cwd(), 'AGENTS.md');

  // Bake this install's version + refresh command into the self-update rule.
  rules = applySelfUpdateTemplate(rules, { version, agent: 'androidstudio', ref: pluginRef, scope });

  console.log(chalk.bold('  ▶  Installing for Android Studio...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl } = mcp;
    const { dir: configDir, detected } = resolveAndroidStudioConfigDir();
    const mcpPath = path.join(configDir, 'mcp.json');
    const mcpSpinner = ora({ text: '  Configuring MCP server', indent: 0 }).start();
    try {
      ensureDir(configDir);
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      // Remote HTTP server (httpUrl). Auth is handled by the IDE's Connect (OAuth) button,
      // so no token/headers are written. weegloo-upload is intentionally omitted — Android
      // Studio does not support stdio MCP servers.
      config.mcpServers['weegloo'] = {
        httpUrl: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
      };

      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
      mcpSpinner.succeed(`  MCP server configured  ${chalk.dim('→ ' + mcpPath)}`);
      if (!detected) {
        console.log(
          chalk.yellow('  ⚠  ') +
          chalk.dim(
            'No existing Android Studio config directory was found; wrote to a default path. ' +
            'If Android Studio does not pick it up, move mcp.json into its configuration directory.'
          )
        );
      }
      console.log(
        chalk.dim('  - Note: weegloo-upload (local file upload) is not installed — Android Studio supports only remote MCP servers.')
      );
    } catch (err) {
      mcpSpinner.fail(`  Failed to configure MCP server: ${err.message}`);
    }
  } else {
    console.log(chalk.dim('  - MCP server: skipped (Skills/Rules only)'));
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

  // ── Rules download & install (→ AGENTS.md) ──────────────────
  if (!installSkillsRules) {
    console.log(chalk.dim('  - Rules: skipped (MCP only)'));
  } else if (rules.length === 0) {
    console.log(chalk.dim('  - Rules: none selected, skipping'));
  } else {
    const rulesSpinner = ora({ text: `  Installing rules (0/${rules.length})`, indent: 0 }).start();
    try {
      ensureDir(path.dirname(agentsPath));
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        rulesSpinner.text = `  Installing rules (${i + 1}/${rules.length}) ${chalk.dim(rule.id)}`;
        upsertRuleInAgentsMd(agentsPath, rule.id, rule.content);
      }
      rulesSpinner.succeed(
        `  Rules installed    ${chalk.dim(`(${rules.length})  → ${agentsPath}`)}`
      );
    } catch (err) {
      rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
    }
  }

  // Arm the version-check throttle stamp so the weegloo-version rule's 14-day window starts.
  if (installSkillsRules && rules.some((r) => r.id === SELF_UPDATE_RULE_ID)) {
    const stampPath = writeVersionStamp(scope);
    if (stampPath) console.log(chalk.dim(`  - Version check armed  → ${stampPath}`));
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Android Studio to apply the MCP server configuration.'));
}
