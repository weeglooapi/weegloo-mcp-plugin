import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Writes file content to localPath, creating parent directories as needed. */
export function writeContentFile(localPath, content) {
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, content, 'utf-8');
}

/**
 * stdio launch command for the local `weegloo-upload` MCP server.
 *
 * With `injectPath` (set when the target runs inside a GUI host such as Xcode
 * Intelligence), the `env.PATH` is pinned to the bin directory of the node
 * running this installer. GUI-hosted MCP clients spawn servers with the bare
 * login PATH (`/usr/bin:/bin`), where nvm/homebrew node installs are invisible,
 * so bare `npx` fails with ENOENT and the server's tools silently never appear.
 * PATH (not an absolute `command`) is enough on its own: it covers both locating
 * `npx` and npx's own `#!/usr/bin/env node` shebang lookup. Terminal-launched
 * agents don't need it, so it is omitted unless `injectPath` is set. Note the PATH
 * embeds this node's version dir — re-run the installer after a node upgrade.
 *
 * On Windows, `npx` resolves to `npx.cmd`, which an MCP client that spawns the
 * process without a shell cannot execute directly — it fails with ENOENT. Routing
 * it through `cmd /c` runs the shim via the command interpreter, and `npx.cmd`
 * locates node.exe next to itself, so no PATH injection is needed there.
 *
 * @param {{ injectPath?: boolean, execPath?: string, platform?: NodeJS.Platform }} [opts] injectable for tests
 * @returns {{ command: string, args: string[], env: Record<string, string> }}
 */
export function uploadServerCommand({
  injectPath = false,
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'npx', '-y', 'weegloo-upload'], env: {} };
  }

  const env = {};
  if (injectPath) {
    const binDir = path.dirname(execPath);
    env.PATH = `${binDir}:/usr/bin:/bin`;
  }
  return { command: 'npx', args: ['-y', 'weegloo-upload'], env };
}
