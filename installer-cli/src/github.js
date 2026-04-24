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

/** Plugin package root within this repo (Claude / Cursor marketplace layout). */
export const PLUGIN_PACKAGE_ROOT = 'plugins/weegloo';

/**
 * @param {string} repoContentPrefix  '' = legacy repo-root skills/rules; else e.g. {@link PLUGIN_PACKAGE_ROOT}
 * @param {string} relativePath  path under repo root, e.g. skills/foo/SKILL.md
 */
export function repoContentPath(repoContentPrefix, relativePath) {
  const rel = String(relativePath).replace(/^\/+/, '');
  if (!repoContentPrefix) return rel;
  return `${repoContentPrefix.replace(/\/+$/, '')}/${rel}`;
}

/**
 * @param {string} ref
 * @param {string} contentsApiPath  path under /contents/ (no leading slash)
 * @returns {Promise<object[] | null>}
 */
async function fetchContentsJson(ref, contentsApiPath) {
  const res = await fetch(
    `${GITHUB_API_CONTENTS}/${contentsApiPath}?ref=${encodeURIComponent(ref)}`,
    { headers: { Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

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
 *   npx weegloo@1.0.0   →  pluginRef: "v1.0.0"  → GitHub tag:   v1.0.0
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
  const primary = `${RAW_BASE}/${ref}/${PLUGIN_PACKAGE_ROOT}/.mcp.json`;
  const legacy = `${RAW_BASE}/${ref}/.mcp.json`;
  try {
    let res = await fetch(primary);
    if (!res.ok) res = await fetch(legacy);
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
 * Lists skill directory names from a GitHub contents path.
 * @param {string} ref
 * @param {string} skillsContentsPath  e.g. plugins/weegloo/skills or skills
 */
async function listSkillIdsFromContents(ref, skillsContentsPath) {
  const data = await fetchContentsJson(ref, skillsContentsPath);
  if (!data) return [];
  return data
    .filter((e) => e.type === 'dir')
    .map((e) => e.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Lists rule base names (without .mdc) from a GitHub contents path.
 * @param {string} ref
 * @param {string} rulesContentsPath  e.g. plugins/weegloo/rules or rules
 */
async function listRuleIdsFromContents(ref, rulesContentsPath) {
  const data = await fetchContentsJson(ref, rulesContentsPath);
  if (!data) return [];
  return data
    .filter((e) => e.type === 'file' && e.name.endsWith('.mdc'))
    .map((e) => e.name.replace(/\.mdc$/, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Fetches skill/rule ids and which repo layout the ref uses (nested plugin vs legacy repo root).
 * @param {string} ref Branch or tag name
 * @returns {Promise<{ skills: string[], rules: string[], repoContentPrefix: string }>}
 */
export async function fetchResourceLists(ref) {
  try {
    const nestedSkills = await listSkillIdsFromContents(ref, `${PLUGIN_PACKAGE_ROOT}/skills`);
    if (nestedSkills.length > 0) {
      const nestedRules = await listRuleIdsFromContents(ref, `${PLUGIN_PACKAGE_ROOT}/rules`);
      return {
        skills: nestedSkills,
        rules: nestedRules.length > 0 ? nestedRules : DEFAULT_RULE_IDS,
        repoContentPrefix: PLUGIN_PACKAGE_ROOT,
      };
    }

    const legacySkills = await listSkillIdsFromContents(ref, 'skills');
    const legacyRules = await listRuleIdsFromContents(ref, 'rules');
    return {
      skills: legacySkills.length > 0 ? legacySkills : DEFAULT_SKILL_IDS,
      rules: legacyRules.length > 0 ? legacyRules : DEFAULT_RULE_IDS,
      repoContentPrefix: '',
    };
  } catch {
    return {
      skills: DEFAULT_SKILL_IDS,
      rules: DEFAULT_RULE_IDS,
      repoContentPrefix: '',
    };
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
