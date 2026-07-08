import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';
import { writeContentFile, uploadServerCommand } from './io.js';
import { applySelfUpdateTemplate, writeVersionStamp, SELF_UPDATE_RULE_ID } from './self-update.js';

/**
 * @param {'global' | 'project'} scope
 * @returns {string} Absolute path to the Codex home directory (.codex)
 */
export function getCodexHome(scope = 'project') {
  return scope === 'global'
    ? path.join(os.homedir(), '.codex')
    : path.join(process.cwd(), '.codex');
}

/**
 * @param {'global' | 'project'} scope
 * @returns {string} Absolute path to config.toml
 */
export function getCodexConfigPath(scope = 'project') {
  return path.join(getCodexHome(scope), 'config.toml');
}

/**
 * @param {'global' | 'project'} scope
 * @returns {string} Absolute path to AGENTS.md
 */
export function getCodexInstructionsPath(scope = 'project') {
  return scope === 'global'
    ? path.join(getCodexHome('global'), 'AGENTS.md')
    : path.join(process.cwd(), 'AGENTS.md');
}

/**
 * @param {'global' | 'project'} scope
 * @returns {string} Absolute path to the skills directory
 */
export function getCodexSkillsDir(scope = 'project') {
  return scope === 'global'
    ? path.join(os.homedir(), '.agents', 'skills')
    : path.join(process.cwd(), '.agents', 'skills');
}

const WEEGLOO_MCP_SECTIONS = new Set([
  'mcp_servers.weegloo',
  'mcp_servers.weegloo-upload',
  'mcp_servers.weegloo-upload.env',
]);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildMcpUrlWithGroup(baseUrl, group) {
  if (!group) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}group=${encodeURIComponent(group)}`;
}

function escapeTomlString(value) {
  const s = String(value);
  if (!/[\n\r"\\]/.test(s)) return `"${s}"`;
  return `"""${s.replace(/\\/g, '\\\\')}"""`;
}

/**
 * Escapes a value for use as a quoted key in a TOML table header
 * (e.g. `[projects."C:\\Users\\me"]`). Table-header keys must be single-line
 * basic strings — escapeTomlString's multi-line `"""…"""` form is invalid there.
 */
function tomlKeyString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Unquotes a raw TOML key segment (`"…"`, `'…'`, or bare) back to its value.
 */
function unquoteTomlKey(raw) {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

/**
 * Finds the `[projects."<projectPath>"]` entry in a config.toml string.
 * @returns {{ found: boolean, trustLevel?: string | null }}
 */
export function readCodexProjectTrust(toml, projectPath) {
  let inTarget = false;
  let found = false;
  let trustLevel = null;

  for (const line of toml.split(/\r?\n/)) {
    const section = line.match(/^\[(.+)\]\s*$/);
    if (section) {
      const name = section[1].trim();
      inTarget =
        name.startsWith('projects.') &&
        unquoteTomlKey(name.slice('projects.'.length)) === projectPath;
      if (inTarget) found = true;
      continue;
    }
    if (inTarget) {
      const kv = line.match(/^\s*trust_level\s*=\s*"([^"]*)"/);
      if (kv) trustLevel = kv[1];
    }
  }

  return found ? { found: true, trustLevel } : { found: false };
}

/**
 * Marks a project as trusted in the user-level Codex config. Codex only loads
 * project-scoped `.codex/` layers (including `.codex/config.toml` with the MCP
 * servers this installer writes) for trusted projects, and the trust record
 * must live in `~/.codex/config.toml` — a project cannot declare itself trusted.
 *
 * An existing `[projects."…"]` entry is never modified: an explicit untrusted
 * decision is the user's to change.
 *
 * @param {string} projectPath Absolute path of the project directory
 * @param {string} [configPath] User-level config.toml (defaults to `~/.codex/config.toml`)
 * @returns {{ status: 'added' | 'exists', trustLevel: string | null, configPath: string }}
 */
export function ensureCodexProjectTrust(projectPath, configPath = getCodexConfigPath('global')) {
  ensureDir(path.dirname(configPath));
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';

  const current = readCodexProjectTrust(existing, projectPath);
  if (current.found) {
    return { status: 'exists', trustLevel: current.trustLevel ?? null, configPath };
  }

  const block = `[projects.${tomlKeyString(projectPath)}]\ntrust_level = "trusted"\n`;
  const base = existing.trimEnd();
  fs.writeFileSync(configPath, base ? `${base}\n\n${block}` : block, 'utf-8');
  return { status: 'added', trustLevel: 'trusted', configPath };
}

/**
 * Removes existing Weegloo MCP tables so re-runs do not duplicate sections.
 * @param {string} toml
 */
export function stripWeeglooMcpSections(toml) {
  const lines = toml.split(/\r?\n/);
  const out = [];
  let skip = false;

  for (const line of lines) {
    const section = line.match(/^\[([^\]]+)\]\s*$/);
    if (section) {
      skip = WEEGLOO_MCP_SECTIONS.has(section[1]);
      if (!skip) out.push(line);
      continue;
    }
    if (!skip) out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * @param {{ weeglooUrl: string, uploadApiUrl: string, token: string, injectPath?: boolean }} config
 */
export function buildWeeglooMcpToml({ weeglooUrl, uploadApiUrl, token, injectPath = false }) {
  const { command, args, env } = uploadServerCommand({ injectPath });
  return [
    '[mcp_servers.weegloo]',
    `url = ${escapeTomlString(weeglooUrl)}`,
    '',
    '[mcp_servers.weegloo-upload]',
    `command = ${escapeTomlString(command)}`,
    `args = [${args.map(escapeTomlString).join(', ')}]`,
    '',
    '[mcp_servers.weegloo-upload.env]',
    ...Object.entries(env).map(([k, v]) => `${k} = ${escapeTomlString(v)}`),
    `UPLOAD_API_URL = ${escapeTomlString(uploadApiUrl)}`,
    `AUTH_BEARER_TOKEN = ${escapeTomlString(token)}`,
    '',
  ].join('\n');
}

/**
 * Merges Weegloo MCP blocks into an existing config.toml string.
 */
export function mergeCodexConfig(existingToml, mcpConfig) {
  const base = existingToml ? stripWeeglooMcpSections(existingToml) : '';
  const block = buildWeeglooMcpToml(mcpConfig);
  if (!base) return `${block}\n`;
  return `${base}\n\n${block}`;
}

/**
 * Backward-compatible alias for callers that still import the old helper name.
 * Codex instruction rules are stored in AGENTS.md, not in Codex command .rules files.
 *
 * @param {'global' | 'project'} scope
 * @returns {string} Absolute path to AGENTS.md
 */
export function getCodexRulesPath(scope = 'project') {
  return getCodexInstructionsPath(scope);
}

/**
 * UTF-8 byte-order mark. Prepended to the Markdown context files we write (AGENTS.md /
 * GEMINI.md) so Windows editors reliably detect them as UTF-8 instead of guessing the
 * system ANSI codepage (e.g. CP949), which garbles non-ASCII rule text (Korean, etc.).
 */
const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Appends or replaces a rule section in a Markdown context file (AGENTS.md / GEMINI.md),
 * keyed by a per-rule marker. Always (re)writes the file with a leading UTF-8 BOM, and
 * strips any pre-existing BOM first so it is never duplicated or left mid-file.
 */
export function upsertRuleInAgentsMd(agentsPath, ruleName, content) {
  const marker = `<!-- weegloo:${ruleName} -->`;
  const endMarker = `<!-- /weegloo:${ruleName} -->`;
  const section = `\n${marker}\n${content.trim()}\n${endMarker}\n`;

  let existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
  if (existing.charCodeAt(0) === 0xfeff) existing = existing.slice(1);

  const write = (body) => fs.writeFileSync(agentsPath, UTF8_BOM + body, 'utf-8');

  if (existing.includes(marker)) {
    const start = existing.indexOf(marker);
    const end = existing.indexOf(endMarker, start);
    if (end !== -1) {
      const before = existing.slice(0, start).trimEnd();
      const after = existing.slice(end + endMarker.length).trimStart();
      const merged = [before, section.trim(), after].filter(Boolean).join('\n\n');
      write(`${merged}\n`);
      return;
    }
  }

  const prefix = existing.trimEnd();
  write(prefix ? `${prefix}\n${section}` : section.trimStart());
}

export async function installCodex({
  token,
  pluginRef,
  version,
  mcpGroup,
  skills = [],
  rules = [],
  mcp = {},
  scope = 'project',
  host,
  installMcp,
  installSkillsRules,
}) {
  // Bake this install's version + refresh command into the self-update rule (option B).
  rules = applySelfUpdateTemplate(rules, { version, agent: 'codex', ref: pluginRef, scope });
  const configPath = getCodexConfigPath(scope);
  const skillsDir = getCodexSkillsDir(scope);
  const instructionsPath = getCodexInstructionsPath(scope);

  console.log(chalk.bold('  ▶  Installing for Codex...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = mcp;
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(path.dirname(configPath));
      const existing = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, 'utf-8')
        : '';
      const merged = mergeCodexConfig(existing, {
        weeglooUrl: buildMcpUrlWithGroup(weeglooUrl, mcpGroup),
        uploadApiUrl,
        token,
        injectPath: host === 'xcode',
      });
      fs.writeFileSync(configPath, merged, 'utf-8');
      mcpSpinner.succeed(
        `  MCP servers configured  ${chalk.dim('→ ' + configPath)}`
      );
    } catch (err) {
      mcpSpinner.fail(`  Failed to configure MCP servers: ${err.message}`);
    }

    if (scope === 'project') {
      const trustSpinner = ora({ text: '  Trusting project in Codex', indent: 0 }).start();
      try {
        const result = ensureCodexProjectTrust(process.cwd());
        if (result.status === 'added') {
          trustSpinner.succeed(
            `  Project trusted in Codex  ${chalk.dim('→ ' + result.configPath)}`
          );
        } else if (result.trustLevel === 'trusted') {
          trustSpinner.succeed(
            `  Project already trusted in Codex  ${chalk.dim('→ ' + result.configPath)}`
          );
        } else {
          trustSpinner.warn(
            `  Project is '${result.trustLevel ?? 'untrusted'}' in ${result.configPath} — Codex ignores the project .codex/config.toml until you trust it (left unchanged).`
          );
        }
      } catch (err) {
        trustSpinner.fail(`  Failed to trust project in Codex: ${err.message}`);
      }
    }
  } else {
    console.log(chalk.dim('  - MCP servers: skipped'));
  }

  if (!installSkillsRules) {
    console.log(chalk.dim('  - Skills / Rules: skipped (MCP only)'));
  } else {
    if (skills.length === 0) {
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

    if (rules.length === 0) {
      console.log(chalk.dim('  - Rules: none selected, skipping'));
    } else {
      const rulesSpinner = ora({ text: `  Installing rules (0/${rules.length})`, indent: 0 }).start();
      try {
        ensureDir(path.dirname(instructionsPath));
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          rulesSpinner.text = `  Installing rules (${i + 1}/${rules.length}) ${chalk.dim(rule.id)}`;
          upsertRuleInAgentsMd(instructionsPath, rule.id, rule.content);
        }
        rulesSpinner.succeed(
          `  Rules installed    ${chalk.dim(`(${rules.length})  → ${instructionsPath}`)}`
        );
      } catch (err) {
        rulesSpinner.fail(`  Failed to install rules: ${err.message}`);
      }
    }
  }

  // Arm the version-check throttle stamp so the weegloo-version rule's 14-day window starts.
  if (installSkillsRules && rules.some((r) => r.id === SELF_UPDATE_RULE_ID)) {
    const stampPath = writeVersionStamp(scope);
    if (stampPath) console.log(chalk.dim(`  - Version check armed  → ${stampPath}`));
  }

  console.log();
  console.log(chalk.dim('  💡 Restart Codex if MCP servers do not appear immediately.'));
}

const CODEX_LOGIN_CMD = 'codex mcp login weegloo';

/** Prominent post-install notice for Codex weegloo MCP authentication. */
export function printCodexLoginNotice() {
  const line = '─'.repeat(52);
  console.log();
  console.log(chalk.bgCyan.black.bold('  ▶  CODEX LOGIN REQUIRED  ') + ' '.repeat(28));
  console.log(chalk.bold.cyan('  ┌' + line + '┐'));
  console.log(
    chalk.bold.cyan('  │') +
      chalk.bold.white('  Sign in to the weegloo MCP server:') +
      ' '.repeat(14) +
      chalk.bold.cyan('│')
  );
  console.log(chalk.bold.cyan('  │') + ' '.repeat(52) + chalk.bold.cyan('│'));
  console.log(
    chalk.bold.cyan('  │') +
      '    ' +
      chalk.bgWhite.black.bold(` ${CODEX_LOGIN_CMD} `) +
      ' '.repeat(52 - CODEX_LOGIN_CMD.length - 4) +
      chalk.bold.cyan('│')
  );
  console.log(chalk.bold.cyan('  └' + line + '┘'));
  console.log();
  console.log(
    chalk.dim('  weegloo-upload is already configured via your PAT in config.toml.')
  );
  console.log(
    chalk.dim('  The weegloo HTTP MCP server needs this login step separately.')
  );
  console.log();
}

/**
 * Runs `codex mcp login weegloo` with inherited stdio (interactive OAuth/browser).
 * @returns {Promise<{ ok: boolean, exitCode?: number, reason?: string }>}
 */
export function runCodexMcpLogin() {
  return new Promise((resolve) => {
    const child = spawn('codex', ['mcp', 'login', 'weegloo'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (err) => {
      resolve({
        ok: false,
        reason: err.code === 'ENOENT' ? 'not_found' : err.message,
      });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, exitCode: code ?? 1 });
    });
  });
}

/** Shows login notice and attempts interactive `codex mcp login weegloo`. */
export async function handleCodexMcpLogin() {
  printCodexLoginNotice();
  console.log(chalk.bold('  Running login command now...'));
  console.log();

  const result = await runCodexMcpLogin();

  if (result.reason === 'not_found') {
    console.log();
    console.log(
      chalk.bgYellow.black.bold('  ⚠  CODEX CLI NOT FOUND  ') +
        chalk.yellow('  Install the Codex CLI, then run:')
    );
    console.log();
    console.log(chalk.bold.white(`    ${CODEX_LOGIN_CMD}`));
    console.log();
    return;
  }

  if (!result.ok) {
    console.log();
    console.log(
      chalk.bgYellow.black.bold('  ⚠  LOGIN INCOMPLETE  ') +
        chalk.yellow(
          `  Command exited with code ${result.exitCode ?? 'unknown'}. Run manually:`
        )
    );
    console.log();
    console.log(chalk.bold.white(`    ${CODEX_LOGIN_CMD}`));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold.green('  ✔  Codex MCP login completed.'));
  console.log();
}
