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
 * On Windows, `npx` resolves to `npx.cmd`, which an MCP client that spawns the process
 * without a shell cannot execute directly — it fails with ENOENT. Routing it through
 * `cmd /c` runs the shim via the command interpreter. POSIX invokes `npx` directly.
 *
 * @returns {{ command: string, args: string[] }}
 */
export function uploadServerCommand() {
  return process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', '-y', 'weegloo-upload'] }
    : { command: 'npx', args: ['-y', 'weegloo-upload'] };
}
