import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';
import { writeContentFile, uploadServerCommand, removeSkillDirs } from './io.js';
import { upsertRuleInAgentsMd, removeRuleMarkers } from './codex.js';
import { applySelfUpdateTemplate, syncInstalledRecord } from './self-update.js';

/**
 * Android Studio (Gemini) target.
 *
 * PROJECT-ONLY: Android Studio installs are always project-scoped — there is no global
 * option (index.js normalizes scope to 'project' and never prompts for it).
 *
 *   MCP:    Android Studio's own configuration directory → mcp.json  (NOT per-project;
 *           the newest `AndroidStudio*` config dir is auto-detected). Writes BOTH the remote
 *           `weegloo` server (`httpUrl`; auth via the PAT in an `Authorization: Bearer`
 *           header) AND the local stdio `weegloo-upload` server (npx; auth via the same PAT).
 *   Skills: <project>/.android-studio/skills/<id>/
 *   Rules:  <project>/AGENTS.md  (single file, marker-per-rule upsert — like Antigravity)
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
  token,
  pluginRef,
  version,
  mcpGroup,
  skills,
  rules,
  mcp = {},
  scope, // always 'project' (normalized by index.js) — Android Studio has no global install
  installMcp,
  installSkillsRules,
  manageSkills = false,
  manageRules = false,
  installedSkillIds = [],
  installedRuleIds = [],
}) {
  rules = applySelfUpdateTemplate(rules, { version, agent: 'androidstudio', ref: pluginRef, scope });

  // Project-scoped skills/rules.
  const skillsDir = path.join(process.cwd(), '.android-studio', 'skills');
  const agentsPath = path.join(process.cwd(), 'AGENTS.md');

  console.log(chalk.bold('  ▶  Installing for Android Studio...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = mcp;
    const { dir: configDir, detected } = resolveAndroidStudioConfigDir();
    const mcpPath = path.join(configDir, 'mcp.json');
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(configDir);
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      // Remote HTTP server (httpUrl). Auth is the Personal Access Token, sent directly as
      // an Authorization: Bearer header (no IDE Connect / OAuth step needed).
      config.mcpServers['weegloo'] = {
        httpUrl: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: -1,
        enabled: true,
        trust: false,
        includeTools: [],
        excludeTools: [],
      };
      // Local stdio upload server (npx) — Android Studio runs it like the other IDEs.
      // Auth is the same Personal Access Token (env).
      const { command, args } = uploadServerCommand();
      config.mcpServers['weegloo-upload'] = {
        command,
        args,
        env: {
          UPLOAD_API_URL: uploadApiUrl,
          AUTH_BEARER_TOKEN: token,
        },
      };

      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
      mcpSpinner.succeed(`  MCP servers configured  ${chalk.dim('→ ' + mcpPath)}`);
      if (!detected) {
        console.log(
          chalk.yellow('  ⚠  ') +
          chalk.dim(
            'No existing Android Studio config directory was found; wrote to a default path. ' +
            'If Android Studio does not pick it up, move mcp.json into its configuration directory.'
          )
        );
      }
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

  // ── Rules download & install (→ project AGENTS.md, single file) ─────────────
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

  // Reconcile with the version-check.json record: remove any skill/rule we installed before but
  // are not installing now (deleted upstream OR deselected), rewrite the record, and re-stamp the
  // version check. Android Studio rules live as marker sections inside AGENTS.md.
  if (installSkillsRules) {
    const { removedSkills, removedRules, stampPath } = syncInstalledRecord({
      scope,
      version,
      manageSkills,
      installedSkillIds,
      removeSkills: (ids) => removeSkillDirs(skillsDir, ids),
      manageRules,
      installedRuleIds,
      removeRules: (ids) => removeRuleMarkers(agentsPath, ids),
    });
    if (removedSkills.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedSkills.length} stale skill(s): ${removedSkills.join(', ')}`));
    }
    if (removedRules.length > 0) {
      console.log(chalk.dim(`  - Removed ${removedRules.length} stale rule(s): ${removedRules.join(', ')}`));
    }
    if (stampPath) console.log(chalk.dim(`  - Version check armed  → ${stampPath}`));
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Android Studio to apply the MCP server configuration.'));
}
