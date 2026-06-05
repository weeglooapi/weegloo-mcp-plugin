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
/** Release-asset host (github.com/<repo>/releases). NOT api.github.com — not rate-limited, no git needed. */
const RELEASE_BASE = `https://github.com/${REPO}/releases`;

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
 * Branch names that exist in the GitHub repo but must never appear in the
 * installer's plugin-version picker (internal / non-distributable refs).
 */
const HIDDEN_BRANCHES = new Set(['develop']);

/**
 * Fetches branch names from the plugin GitHub repo (public API, no auth).
 * By default, internal branches in {@link HIDDEN_BRANCHES} are omitted from
 * the list. Pass `{ includeHidden: true }` to list every branch (e.g. CLI `-a`).
 *
 * @param {{ includeHidden?: boolean }} [options]
 * @returns {Promise<string[]>} Branch names, or [] on error.
 */
export async function fetchBranches(options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  try {
    const res = await fetch(GITHUB_API_BRANCHES, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((b) => b.name)
      .filter((name) => {
        if (!name) return false;
        if (includeHidden) return true;
        return !HIDDEN_BRANCHES.has(name);
      });
  } catch {
    return [];
  }
}

const RELEASES_ATOM = `https://github.com/${REPO}/releases.atom`;
const TAGS_ATOM = `https://github.com/${REPO}/tags.atom`;

/**
 * Lists release version tags, newest first, from the static `releases.atom`
 * feed (falling back to `tags.atom`). These are github.com feeds — NOT
 * api.github.com — so they are not subject to the 60-req/hour unauthenticated
 * REST rate limit and need no git client. Returns [] on failure (caller can
 * fall back to just offering `latest`).
 *
 * @returns {Promise<string[]>} e.g. ['v1.0.13', 'v1.0.12', ...]
 */
export async function fetchReleaseVersions() {
  for (const url of [RELEASES_ATOM, TAGS_ATOM]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const tags = [];
      const seen = new Set();
      const re = /releases\/tag\/([^<"\s]+)/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        let tag = m[1];
        try {
          tag = decodeURIComponent(m[1]);
        } catch {
          /* keep raw tag if it is not valid percent-encoding */
        }
        if (!seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
      if (tags.length > 0) return tags;
    } catch {
      // try the next feed
    }
  }
  return [];
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
 * Builds a GitHub Release asset URL. These are plain HTTPS downloads served
 * from GitHub's asset CDN — they need no git client and do NOT consume the
 * api.github.com REST rate limit.
 *
 * A tag-like ref (`v1.0.13`, `1.0.13`) resolves to that specific release; any
 * other ref (`latest`, a branch name, empty) resolves to the latest release.
 *
 * @param {string} ref
 * @param {string} assetName e.g. 'manifest.json' or 'weegloo-bundle.zip'
 */
export function releaseAssetUrl(ref, assetName) {
  const isTag = Boolean(ref) && ref !== 'latest' && /^v?\d/.test(ref);
  return isTag
    ? `${RELEASE_BASE}/download/${encodeURIComponent(ref)}/${assetName}`
    : `${RELEASE_BASE}/latest/download/${assetName}`;
}

/**
 * Fetches the bundle manifest from the Release assets (see {@link releaseAssetUrl}).
 * Returns the parsed manifest, or `null` if no release/manifest exists for this
 * ref (e.g. a branch with no published release) so callers fall back to the
 * Contents API. Never throws on HTTP/parse errors.
 *
 * @param {string} ref
 * @returns {Promise<{ skills: {id:string}[], rules: {id:string}[], repoContentPrefix?: string } | null>}
 */
export async function fetchReleaseManifest(ref) {
  try {
    const res = await fetch(releaseAssetUrl(ref, 'manifest.json'));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.skills) || !Array.isArray(data.rules)) return null;
    return data;
  } catch {
    return null;
  }
}

function idsFromManifest(entries) {
  return entries
    .map((e) => e && e.id)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Fetches skill/rule ids and which repo layout the ref uses (nested plugin vs legacy repo root).
 *
 * Prefers the Release **manifest.json** (one CDN fetch, no api.github.com), so
 * the picker is not capped by the 60-req/hour unauthenticated Contents-API
 * limit. Falls back to the Contents API when no release/manifest is available
 * for the ref (e.g. a feature branch).
 *
 * @param {string} ref Branch or tag name
 * @returns {Promise<{ skills: string[], rules: string[], repoContentPrefix: string }>}
 */
export async function fetchResourceLists(ref) {
  const manifest = await fetchReleaseManifest(ref);
  if (manifest) {
    const skills = idsFromManifest(manifest.skills);
    const rules = idsFromManifest(manifest.rules);
    if (skills.length > 0) {
      return {
        skills,
        rules: rules.length > 0 ? rules : DEFAULT_RULE_IDS,
        repoContentPrefix: manifest.repoContentPrefix ?? PLUGIN_PACKAGE_ROOT,
      };
    }
  }

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
 * Fetches a file's text from GitHub raw content (no disk write).
 * @param {string} ref
 * @param {string} remotePath path under repo root
 * @returns {Promise<string>}
 */
export async function fetchTextFromRepo(ref, remotePath) {
  const url = `${RAW_BASE}/${ref}/${remotePath}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error - ${url}\n  ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n  ${url}`);
  }

  return res.text();
}

/**
 * Downloads a file from GitHub raw content and writes it to localPath.
 */
export async function downloadFile(ref, remotePath, localPath) {
  const text = await fetchTextFromRepo(ref, remotePath);
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, text, 'utf-8');
}

/**
 * Downloads the release bundle zip bytes (weegloo-bundle.zip) for a ref via the
 * Release asset CDN — no git client, no api.github.com. Returns the raw bytes,
 * or `null` if no bundle exists for the ref (caller falls back to per-file raw
 * downloads). Never throws on HTTP errors.
 *
 * @param {string} ref
 * @returns {Promise<Uint8Array | null>}
 */
export async function fetchBundleZip(ref) {
  try {
    const res = await fetch(releaseAssetUrl(ref, 'weegloo-bundle.zip'));
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
