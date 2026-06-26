import fs from 'fs';
import path from 'path';
import os from 'os';
import ora from 'ora';
import chalk from 'chalk';
import { REPO } from './github.js';

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

/**
 * Claude Desktop's MCP config file (official app-data location per OS).
 *
 * Distinct from Claude Code, which reads ~/.claude.json (global) or
 * ./.mcp.json (project). Claude Desktop reads ONLY this file and ignores
 * Claude Code's config entirely. There is no project-scoped variant — the
 * desktop app has a single global config.
 *
 * @returns {string}
 */
export function getClaudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

/**
 * Installer for the Claude Desktop app (NOT Claude Code).
 *
 * Why this is a separate target from `claude` (Claude Code):
 *  - Config path differs: claude_desktop_config.json under the OS app-data
 *    dir, not ~/.claude.json / ./.mcp.json.
 *  - Transport differs: the desktop config file supports ONLY local stdio
 *    servers (command/args). It cannot reference a remote HTTP MCP server as
 *    `{ type: "http", url }` the way Claude Code / Cursor can. The remote
 *    weegloo server is therefore bridged through the `mcp-remote` stdio proxy,
 *    which runs the OAuth "Connect" handshake in the browser on first launch.
 *  - No filesystem Skills/Rules: Claude Desktop does not read ~/.claude/skills
 *    or ~/.claude/rules; those apply to Claude Code only. This target is
 *    MCP-only and never writes Skills/Rules.
 */
export async function installClaudeDesktop({
  token,
  pluginRef,
  mcpGroup,
  mcp = {},
  installMcp,
}) {
  const mcpPath = getClaudeDesktopConfigPath();

  console.log(chalk.bold('  ▶  Installing for Claude Desktop...'));
  console.log(chalk.dim(`     github: ${REPO} @ ${chalk.cyan(pluginRef)}`));
  console.log();

  if (installMcp) {
    const { weeglooUrl, uploadApiUrl } = mcp;
    const mcpSpinner = ora({ text: '  Configuring MCP servers', indent: 0 }).start();
    try {
      ensureDir(path.dirname(mcpPath));
      const config = readJsonSafe(mcpPath);
      if (!config.mcpServers) config.mcpServers = {};

      // Remote HTTP server → bridged via mcp-remote (desktop config is stdio-only).
      // mcp-remote handles the OAuth browser sign-in, so no token is embedded here.
      config.mcpServers['weegloo'] = {
        command: 'npx',
        args: ['-y', 'mcp-remote', buildMcpUrlWithGroup(weeglooUrl, mcpGroup)],
      };
      // Local stdio server → works in the desktop config as-is (same as elsewhere).
      config.mcpServers['weegloo-upload'] = {
        command: 'npx',
        args: ['-y', 'weegloo-upload'],
        env: {
          UPLOAD_API_URL: uploadApiUrl,
          AUTH_BEARER_TOKEN: token,
        },
      };

      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
      mcpSpinner.succeed(
        `  MCP servers configured  ${chalk.dim('→ ' + mcpPath)}`
      );
    } catch (err) {
      mcpSpinner.fail(`  Failed to configure MCP servers: ${err.message}`);
    }
  } else {
    console.log(chalk.dim('  - MCP servers: skipped (nothing else to install for Claude Desktop)'));
  }

  // Claude Desktop has no filesystem Skills/Rules — make the gap explicit so the
  // user is not left expecting them. (See module doc above.)
  console.log(
    chalk.dim(
      '  - Skills/Rules: not applicable. Claude Desktop does not read ~/.claude/skills or'
    )
  );
  console.log(
    chalk.dim(
      '    ~/.claude/rules; those apply to Claude Code. Use the `claude` target for those.'
    )
  );

  // ── Next steps ──────────────────────────────────────────────
  console.log();
  console.log(chalk.dim('  💡 Restart Claude Desktop to load the new MCP servers.'));
  if (installMcp) {
    console.log(
      chalk.dim(
        '     On first launch the weegloo server opens a browser to sign in (OAuth via mcp-remote).'
      )
    );
    console.log(
      chalk.dim(
        '     Claude Pro/Max/Team/Enterprise users may instead add it as a Custom Connector'
      )
    );
    console.log(chalk.dim('     in Settings → Connectors (paste the server URL).'));
  }
}
