import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const REPO = 'weeglooapi/weegloo-mcp-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;
const GITHUB_API_BRANCHES = `https://api.github.com/repos/${REPO}/branches?per_page=100`;
const GITHUB_API_CONTENTS = `https://api.github.com/repos/${REPO}/contents`;

export const SKILL_FILES = ['SKILL.md', 'metadata.json'];

/**
 * Fetches branch names from the plugin GitHub repo (public API, no auth).
 * @returns {Promise<string[]>} Branch names, or [] on error.
 */
export async function fetchBranches() {
  try {
    const res = await fetch(GITHUB_API_BRANCHES, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.map((b) => b.name).filter(Boolean) : [];
  } catch {
    return [];
  }
}

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

const DEFAULT_MCP_URL = 'https://ai.weegloo.com/mcp';
const DEFAULT_UPLOAD_API_URL = 'https://upload.weegloo.com/v1';

/**
 * Fetches .mcp.json from the given ref and returns weegloo URL and upload API URL.
 * Used so that dev-latest (etc.) branches get dev-ai.weegloo.com / dev-upload.weegloo.com.
 * @param {string} ref Branch or tag name
 * @returns {Promise<{ weeglooUrl: string, uploadApiUrl: string }>} URLs from branch, or defaults
 */
export async function fetchMcpConfig(ref) {
  const url = `${RAW_BASE}/${ref}/.mcp.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL };
    const data = await res.json();
    const servers = data?.mcpServers ?? {};
    const weeglooUrl =
      typeof servers.weegloo?.url === 'string' ? servers.weegloo.url : DEFAULT_MCP_URL;
    const uploadEnv = servers['weegloo-upload']?.env ?? {};
    const uploadApiUrl =
      typeof uploadEnv.UPLOAD_API_URL === 'string'
        ? uploadEnv.UPLOAD_API_URL
        : DEFAULT_UPLOAD_API_URL;
    return { weeglooUrl, uploadApiUrl };
  } catch {
    return { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL };
  }
}

/** Default skill/rule IDs when branch listing fails (e.g. offline). */
export const DEFAULT_SKILL_IDS = ['weegloo-create-content-type', 'weegloo-web-hosting'];
export const DEFAULT_RULE_IDS = ['weegloo-global-rules', 'weegloo-web-hosting-rules'];

/**
 * Fetches the list of skills (dirs under skills/) and rules (.mdc files under rules/) for the given ref.
 * All resources are taken from the selected branch.
 * @param {string} ref Branch or tag name
 * @returns {Promise<{ skills: string[], rules: string[] }>} Lists from branch, or defaults on error
 */
export async function fetchResourceLists(ref) {
  try {
    const [skillsRes, rulesRes] = await Promise.all([
      fetch(`${GITHUB_API_CONTENTS}/skills?ref=${encodeURIComponent(ref)}`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      }),
      fetch(`${GITHUB_API_CONTENTS}/rules?ref=${encodeURIComponent(ref)}`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      }),
    ]);
    let skills = DEFAULT_SKILL_IDS;
    let rules = DEFAULT_RULE_IDS;
    if (skillsRes.ok) {
      const data = await skillsRes.json();
      if (Array.isArray(data)) {
        const list = data.filter((e) => e.type === 'dir').map((e) => e.name).filter(Boolean);
        if (list.length > 0) skills = list.sort((a, b) => a.localeCompare(b));
      }
    }
    if (rulesRes.ok) {
      const data = await rulesRes.json();
      if (Array.isArray(data)) {
        const list = data
          .filter((e) => e.type === 'file' && e.name.endsWith('.mdc'))
          .map((e) => e.name.replace(/\.mdc$/, ''))
          .filter(Boolean);
        if (list.length > 0) rules = list.sort((a, b) => a.localeCompare(b));
      }
    }
    return { skills, rules };
  } catch {
    return { skills: DEFAULT_SKILL_IDS, rules: DEFAULT_RULE_IDS };
  }
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
