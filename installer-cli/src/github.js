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

/** Plugin package root within this repo (Claude / Cursor marketplace layout). */
export const PLUGIN_PACKAGE_ROOT = 'plugins/weegloo';

const DEFAULT_MCP_URL = 'https://ai.weegloo.com/mcp';
const DEFAULT_UPLOAD_API_URL = 'https://upload.weegloo.com/v1';

// ── transport seam ──────────────────────────────────────────────────────────
// All network access goes through httpGet so retry/backoff lives in one place
// (raw can 429 under load — bazarr #3057) and tests mock fetch in one spot.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-attempt deadline so a stalled connection can't block the fallback chain. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * @param {string} url
 * @param {{ retry?: number, headers?: Record<string,string>, timeout?: number }} [opts]
 * @returns {Promise<Response>}
 */
async function httpGet(url, opts = {}) {
  const { retry = 0, headers, timeout = REQUEST_TIMEOUT_MS } = opts;
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, ...(headers ? { headers } : {}) });
      if ((res.status === 429 || res.status >= 500) && attempt < retry) {
        attempt += 1;
        await delay(Math.min(250 * 2 ** attempt, 2000));
        continue;
      }
      return res;
    } catch (err) {
      // Network error or timeout abort → retry while attempts remain, else surface.
      if (attempt < retry) {
        attempt += 1;
        await delay(Math.min(250 * 2 ** attempt, 2000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
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

// ── VersionSource: branch list for the picker ────────────────────────────────

/**
 * Parses branch names from a git-upload-pack ref advertisement (pkt-line text).
 * Anchors on the 40-hex object id so the 4-byte pkt-line length prefix is
 * ignored, and stops at NUL/newline so the capability string trailing the first
 * ref line is dropped.
 * @param {string} text
 * @returns {string[]} de-duplicated branch names in advertisement order (ordering is the caller's concern)
 */
export function parseBranchesFromInfoRefs(text) {
  const names = new Set();
  const re = /[0-9a-f]{40} refs\/heads\/([^\n\0]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name = match[1].split(/[\0 ]/)[0].trim();
    if (name) names.add(name);
  }
  return [...names];
}

async function infoRefsBranches() {
  const res = await httpGet(INFO_REFS_URL, { retry: 1 });
  if (!res.ok) return null;
  const names = parseBranchesFromInfoRefs(await res.text());
  return names.length > 0 ? names : null;
}

/**
 * Lists ALL branch names from the repo (data access only). Picker visibility &
 * ordering — the semver-only policy and the `-a` show-all — live in
 * `orderBranchesForPicker` (versions.js).
 * Strategy chain: git smart-HTTP info/refs → ['latest'] fallback.
 * (A future git-CLI strategy slots in at the front of this chain — see ADR D6.)
 *
 * @returns {Promise<string[]>}
 */
export async function listBranches() {
  // The final ['latest'] strategy always yields a non-empty list, so this is non-null.
  return firstUsable(
    [infoRefsBranches, () => ['latest']],
    (arr) => Array.isArray(arr) && arr.length > 0
  );
}

// ── ResourceSource: manifest (content + MCP) for a ref ───────────────────────

/** Manifest schema version this CLI understands. A newer manifest is rejected (caller falls back). */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Coerces a raw manifest JSON into the normalized resource shape, or null if it is
 * not a manifest of the supported schema version. Entries with missing/empty
 * id/content are dropped so a partially-corrupt manifest can't install blank files.
 */
function normalizeManifest(data) {
  if (!data || data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return null;
  if (!Array.isArray(data.skills) || !Array.isArray(data.rules)) return null;
  const skills = data.skills
    .filter((s) => s && typeof s.id === 'string' && s.id && s.files && typeof s.files === 'object')
    .map((s) => {
      const files = {};
      for (const [name, content] of Object.entries(s.files)) {
        if (name && typeof content === 'string') files[name] = content;
      }
      return { id: s.id, files };
    })
    .filter((s) => Object.keys(s.files).length > 0);
  const rules = data.rules
    .filter((r) => r && typeof r.id === 'string' && r.id && typeof r.content === 'string' && r.content)
    .map((r) => ({ id: r.id, content: r.content }));
  return {
    source: 'manifest',
    repoContentPrefix: typeof data.repoContentPrefix === 'string' ? data.repoContentPrefix : '',
    mcp: {
      weeglooUrl: typeof data.mcp?.weeglooUrl === 'string' ? data.mcp.weeglooUrl : DEFAULT_MCP_URL,
      uploadApiUrl:
        typeof data.mcp?.uploadApiUrl === 'string' ? data.mcp.uploadApiUrl : DEFAULT_UPLOAD_API_URL,
    },
    skills,
    rules,
  };
}

/**
 * Fetches the branch-committed installer manifest (one raw request — no api.github.com).
 * @param {string} ref
 * @returns {Promise<object|null>} normalized resources, or null if no valid manifest
 */
export async function fetchManifest(ref) {
  const url = `${RAW_BASE}/${ref}/${PLUGIN_PACKAGE_ROOT}/installer-manifest.json`;
  try {
    const res = await httpGet(url, { retry: 2 });
    if (!res.ok) return null;
    return normalizeManifest(await res.json());
  } catch {
    return null;
  }
}

/**
 * Loads everything ref-scoped (skill/rule lists + content + MCP URLs) for `ref`
 * in a single normalized shape. Install code consumes this shape and never touches
 * the network — so swapping the source (e.g. a CDN mirror) changes nothing downstream.
 * See ADR D6.
 *
 * Source: the branch-committed manifest (one raw request). If absent/invalid, returns
 * `source: 'none'` with empty lists + default MCP URLs; index.js surfaces that to the
 * user rather than silently installing a guessed subset.
 *
 * @param {string} ref
 * @returns {Promise<{ source: string, repoContentPrefix: string, mcp: {weeglooUrl:string, uploadApiUrl:string}, skills: Array<{id:string, files:Record<string,string>}>, rules: Array<{id:string, content:string}> }>}
 */
export async function loadResources(ref) {
  const manifest = await fetchManifest(ref);
  if (manifest) return manifest;
  return {
    source: 'none',
    repoContentPrefix: '',
    mcp: { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL },
    skills: [],
    rules: [],
  };
}
