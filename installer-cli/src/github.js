import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const REPO = 'weeglooapi/weegloo-mcp-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;

/**
 * Branch list source: git smart-HTTP ref advertisement. This is NOT
 * `api.github.com`, so it does not draw from the 60-req/hour REST "core" bucket.
 * See installer-cli/docs/0001-skill-rule-distribution.md (D3, §8).
 */
const INFO_REFS_URL = `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;

export const SKILL_FILES = ['SKILL.md', 'metadata.json'];

/** Plugin package root within this repo (Claude / Cursor marketplace layout). */
export const PLUGIN_PACKAGE_ROOT = 'plugins/weegloo';

const DEFAULT_MCP_URL = 'https://ai.weegloo.com/mcp';
const DEFAULT_UPLOAD_API_URL = 'https://upload.weegloo.com/v1';

/** Default skill/rule IDs when a branch has no manifest (offline / mis-provisioned). */
export const DEFAULT_SKILL_IDS = ['weegloo-create-content-type', 'weegloo-web-hosting'];
export const DEFAULT_RULE_IDS = ['weegloo-global-rules', 'weegloo-web-hosting-rules'];

/**
 * Branch names that exist in the repo but must never appear in the installer's
 * plugin-version picker (internal / non-distributable refs).
 */
const HIDDEN_BRANCHES = new Set(['develop']);

// ── transport seam ──────────────────────────────────────────────────────────
// All network access goes through httpGet so retry/backoff lives in one place
// (raw can 429 under load — bazarr #3057) and tests mock fetch in one spot.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @param {{ retry?: number, headers?: Record<string,string> }} [opts]
 * @returns {Promise<Response>}
 */
async function httpGet(url, opts = {}) {
  const { retry = 0, headers } = opts;
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if ((res.status === 429 || res.status >= 500) && attempt < retry) {
        attempt += 1;
        await delay(Math.min(250 * 2 ** attempt, 2000));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retry) {
        attempt += 1;
        await delay(Math.min(250 * 2 ** attempt, 2000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Tries each async strategy in order, returning the first "usable" result.
 * Errors and unusable results fall through to the next strategy.
 * @template T
 * @param {Array<() => Promise<T>>} strategies
 * @param {(value: T) => boolean} isUsable
 * @returns {Promise<T | null>}
 */
async function firstUsable(strategies, isUsable) {
  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (isUsable(result)) return result;
    } catch {
      /* try next strategy */
    }
  }
  return null;
}

/**
 * Determines the GitHub ref (branch or tag) to fetch plugin files from.
 *
 * Priority: CLI `--ref <ref>` → env `WEEGLOO_REF` → package.json `pluginRef` → 'latest'.
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
 * @param {string} repoContentPrefix  '' = legacy repo-root skills/rules; else e.g. {@link PLUGIN_PACKAGE_ROOT}
 * @param {string} relativePath  path under repo root, e.g. skills/foo/SKILL.md
 */
export function repoContentPath(repoContentPrefix, relativePath) {
  const rel = String(relativePath).replace(/^\/+/, '');
  if (!repoContentPrefix) return rel;
  return `${repoContentPrefix.replace(/\/+$/, '')}/${rel}`;
}

// ── VersionSource: branch list for the picker ────────────────────────────────

/**
 * Parses branch names from a git-upload-pack ref advertisement (pkt-line text).
 * Anchors on the 40-hex object id so the 4-byte pkt-line length prefix is
 * ignored, and stops at NUL/newline so the capability string trailing the first
 * ref line is dropped.
 * @param {string} text
 * @returns {string[]} sorted, de-duplicated branch names
 */
export function parseBranchesFromInfoRefs(text) {
  const names = new Set();
  const re = /[0-9a-f]{40} refs\/heads\/([^\n\0]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name = match[1].split(/[\0 ]/)[0].trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function infoRefsBranches() {
  const res = await httpGet(INFO_REFS_URL, { retry: 1 });
  if (!res.ok) return null;
  const names = parseBranchesFromInfoRefs(await res.text());
  return names.length > 0 ? names : null;
}

/**
 * Lists distributable branch names for the version picker.
 * Strategy chain: git smart-HTTP info/refs → ['latest'] fallback.
 * (A future git-CLI strategy slots in at the front of this chain — see ADR D6.)
 *
 * @param {{ includeHidden?: boolean }} [options]  includeHidden=true keeps `develop` (CLI `-a`)
 * @returns {Promise<string[]>}
 */
export async function listBranches(options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  const all = await firstUsable(
    [infoRefsBranches, () => ['latest']],
    (arr) => Array.isArray(arr) && arr.length > 0
  );
  const names = all ?? ['latest'];
  return names.filter((name) => {
    if (!name) return false;
    if (includeHidden) return true;
    return !HIDDEN_BRANCHES.has(name);
  });
}

// ── ResourceSource: manifest (content + MCP) for a ref ───────────────────────

function manifestCandidates(ref) {
  return [
    `${RAW_BASE}/${ref}/${PLUGIN_PACKAGE_ROOT}/installer-manifest.json`,
    `${RAW_BASE}/${ref}/installer-manifest.json`,
  ];
}

/** Coerces a raw manifest JSON into the normalized resource shape, or null if invalid. */
function normalizeManifest(data) {
  if (!data || !Array.isArray(data.skills) || !Array.isArray(data.rules)) return null;
  return {
    source: 'manifest',
    repoContentPrefix: typeof data.repoContentPrefix === 'string' ? data.repoContentPrefix : '',
    mcp: {
      weeglooUrl: typeof data.mcp?.weeglooUrl === 'string' ? data.mcp.weeglooUrl : DEFAULT_MCP_URL,
      uploadApiUrl:
        typeof data.mcp?.uploadApiUrl === 'string' ? data.mcp.uploadApiUrl : DEFAULT_UPLOAD_API_URL,
    },
    skills: data.skills
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => ({ id: s.id, files: s.files && typeof s.files === 'object' ? s.files : {} })),
    rules: data.rules
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => ({ id: r.id, content: typeof r.content === 'string' ? r.content : '' })),
  };
}

/**
 * Fetches the branch-committed installer manifest (one raw request — no api.github.com).
 * @param {string} ref
 * @returns {Promise<object|null>} normalized resources, or null if no valid manifest
 */
export async function fetchManifest(ref) {
  for (const url of manifestCandidates(ref)) {
    try {
      const res = await httpGet(url, { retry: 2 });
      if (!res.ok) continue;
      const normalized = normalizeManifest(await res.json());
      if (normalized) return normalized;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function fetchRawText(ref, repoPath) {
  try {
    const res = await httpGet(`${RAW_BASE}/${ref}/${repoPath}`, { retry: 1 });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function mcpFromRaw(ref) {
  for (const prefix of [PLUGIN_PACKAGE_ROOT, '']) {
    const text = await fetchRawText(ref, repoContentPath(prefix, '.mcp.json'));
    if (text == null) continue;
    try {
      const servers = JSON.parse(text)?.mcpServers ?? {};
      return {
        weeglooUrl: typeof servers.weegloo?.url === 'string' ? servers.weegloo.url : DEFAULT_MCP_URL,
        uploadApiUrl:
          typeof servers['weegloo-upload']?.env?.UPLOAD_API_URL === 'string'
            ? servers['weegloo-upload'].env.UPLOAD_API_URL
            : DEFAULT_UPLOAD_API_URL,
      };
    } catch {
      /* try next prefix */
    }
  }
  return { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL };
}

/**
 * Fallback resource source: a branch with no manifest. Pulls the DEFAULT skill/rule
 * set straight from raw per-file (still no api.github.com) so the installer degrades
 * to a working baseline rather than an empty list.
 * @param {string} ref
 */
async function rawDefaultResources(ref) {
  const prefixes = [PLUGIN_PACKAGE_ROOT, ''];
  let repoContentPrefix = '';
  const skills = [];
  for (const id of DEFAULT_SKILL_IDS) {
    let files = null;
    for (const prefix of prefixes) {
      const skillMd = await fetchRawText(ref, repoContentPath(prefix, `skills/${id}/SKILL.md`));
      if (skillMd == null) continue;
      files = { 'SKILL.md': skillMd };
      for (const file of SKILL_FILES) {
        if (file === 'SKILL.md') continue;
        const extra = await fetchRawText(ref, repoContentPath(prefix, `skills/${id}/${file}`));
        if (extra != null) files[file] = extra;
      }
      repoContentPrefix = prefix;
      break;
    }
    if (files) skills.push({ id, files });
  }
  const rules = [];
  for (const id of DEFAULT_RULE_IDS) {
    const content = await fetchRawText(ref, repoContentPath(repoContentPrefix, `rules/${id}.mdc`));
    if (content != null) rules.push({ id, content });
  }
  if (skills.length === 0 && rules.length === 0) return null;
  return { source: 'raw-default', repoContentPrefix, mcp: await mcpFromRaw(ref), skills, rules };
}

/**
 * Loads everything ref-scoped (skill/rule lists + content + MCP URLs) for `ref`
 * in a single normalized shape, regardless of source. Install code consumes this
 * shape and never touches the network — so swapping the source (e.g. a CDN mirror)
 * changes nothing downstream. See ADR D6.
 *
 * Strategy chain: manifest (1 raw request) → raw-per-file DEFAULT set.
 *
 * @param {string} ref
 * @returns {Promise<{ source: string, repoContentPrefix: string, mcp: {weeglooUrl:string, uploadApiUrl:string}, skills: Array<{id:string, files:Record<string,string>}>, rules: Array<{id:string, content:string}> }>}
 */
export async function loadResources(ref) {
  const result = await firstUsable(
    [() => fetchManifest(ref), () => rawDefaultResources(ref)],
    (r) => r != null
  );
  if (result) return result;
  return {
    source: 'none',
    repoContentPrefix: '',
    mcp: { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL },
    skills: [],
    rules: [],
  };
}

/** Writes embedded file content to localPath, creating parent dirs as needed. */
export function writeContentFile(localPath, content) {
  const dir = path.dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, content, 'utf-8');
}
