import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * A syntactically valid skill/rule id — the token that names a skill directory or a
 * `<id>.<ext>` rule file. Removal is driven by the install record in version-check.json, but
 * every id is re-checked against this pattern before it becomes a path, so a corrupted or
 * hand-edited record can never traverse out of the target directory (no `/`, `\`, or `..`).
 */
export const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Writes file content to localPath, creating parent directories as needed. */
export function writeContentFile(localPath, content) {
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, content, 'utf-8');
}

/**
 * Removes the named weegloo **skill directories** — one subdirectory per id under `skillsDir`.
 * `ids` is the stale set computed by the install-record diff (previously installed, not
 * installed now); each is deleted recursively. The ids come from OUR own version-check.json
 * record, so a user-authored skill is never in the set; each is still re-checked against
 * SAFE_ID (path-traversal guard) before becoming a path, and only existing directories count.
 *
 * @param {string} skillsDir
 * @param {string[]} ids  stale skill ids to remove
 * @returns {string[]} ids that existed and were removed
 */
export function removeSkillDirs(skillsDir, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (!existsSync(skillsDir)) return [];
  const removed = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue;
    const dir = path.join(skillsDir, id);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(id);
  }
  return removed;
}

/**
 * Removes the named weegloo **rule files** — `<id>.<ext>` under `rulesDir` — for the
 * file-per-rule agents (Claude `.md`, Cursor `.mdc`). Same record-driven, SAFE_ID-guarded,
 * existence-checked contract as `removeSkillDirs`. Marker-embedded rules (Codex / Antigravity
 * / Android Studio) use `removeRuleMarkers` (codex.js) instead.
 *
 * @param {string} rulesDir
 * @param {string[]} ids  stale rule ids to remove
 * @param {string} ext    rule file extension, with or without the leading dot
 * @returns {string[]} ids that existed and were removed
 */
export function removeRuleFiles(rulesDir, ids, ext) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (!existsSync(rulesDir)) return [];
  const suffix = ext.startsWith('.') ? ext : `.${ext}`;
  const removed = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue;
    const file = path.join(rulesDir, `${id}${suffix}`);
    if (!existsSync(file)) continue;
    rmSync(file, { force: true });
    removed.push(id);
  }
  return removed;
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
