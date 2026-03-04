import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const REPO = 'weeglooapi/weegloo-mcp-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;

export const SKILL_FILES = ['SKILL.md', 'metadata.json'];

/**
 * Determines the GitHub ref (branch or tag) to fetch plugin files from.
 *
 * Priority:
 *   1. CLI argument  --ref <ref>
 *   2. Environment variable  WEEGLOO_REF
 *   3. pluginRef field in package.json
 *
 * Convention mapping npm dist-tags to GitHub branches/tags:
 *   npx weegloo@latest  →  pluginRef: "latest"  → GitHub branch: latest
 *   npx weegloo@beta    →  pluginRef: "beta"    → GitHub branch: beta
 *   npx weegloo@0.1.0   →  pluginRef: "v0.1.0"  → GitHub tag:   v0.1.0
 */
export function getPluginRef() {
  const argIdx = process.argv.indexOf('--ref');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }
  if (process.env.WEEGLOO_REF) {
    return process.env.WEEGLOO_REF;
  }
  return pkg.pluginRef ?? 'latest';
}

/**
 * Downloads a file from GitHub raw content and writes it to localPath.
 */
export async function downloadFile(ref, remotePath, localPath) {
  const url = `${RAW_BASE}/${ref}/${remotePath}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error — ${url}\n  ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n  ${url}`);
  }

  const text = await res.text();
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, text, 'utf-8');
}
