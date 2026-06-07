import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Default plugin repo; override with WEEGLOO_REPO=owner/name to point the installer at a
// fork / mirror / staging repo (used for end-to-end testing). All URLs below derive from it.
const REPO = process.env.WEEGLOO_REPO || 'weeglooapi/weegloo-mcp-plugin';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;

/**
 * Branch list source: git smart-HTTP ref advertisement. This is NOT
 * `api.github.com`, so it does not draw from the 60-req/hour REST "core" bucket.
 * See installer-cli/docs/0001-skill-rule-distribution.md (D3, §8).
 */
const INFO_REFS_URL = `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;

/** Plugin package root within this repo (Claude / Cursor marketplace layout). */
export const PLUGIN_PACKAGE_ROOT = 'plugins/weegloo';

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

/** Manifest schema version this CLI understands. A different version is rejected (caller fails fast). */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Strictly validates a raw manifest and returns the normalized resource shape, or null
 * if ANYTHING is off: wrong schemaVersion, a missing/non-string field, or a malformed
 * skill/rule entry. The manifest is our own generated artifact, so a mismatch is a build
 * bug — fail loudly (the caller fails fast) instead of defaulting or dropping silently.
 * Defaults for absent fields belong to the producer (build-installer-manifest.mjs), not here.
 */
function normalizeManifest(data) {
  if (!data || data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return null;
  if (typeof data.repoContentPrefix !== 'string') return null;
  if (typeof data.mcp?.weeglooUrl !== 'string' || typeof data.mcp?.uploadApiUrl !== 'string') return null;
  if (!Array.isArray(data.skills) || !Array.isArray(data.rules)) return null;

  const skills = [];
  for (const s of data.skills) {
    if (!s || typeof s.id !== 'string' || !s.id || !s.files || typeof s.files !== 'object') return null;
    const entries = Object.entries(s.files);
    if (entries.length === 0) return null;
    const files = {};
    for (const [name, content] of entries) {
      if (!name || typeof content !== 'string') return null;
      files[name] = content;
    }
    skills.push({ id: s.id, files });
  }

  const rules = [];
  for (const r of data.rules) {
    if (!r || typeof r.id !== 'string' || !r.id || typeof r.content !== 'string' || !r.content) return null;
    rules.push({ id: r.id, content: r.content });
  }

  return {
    source: 'manifest',
    repoContentPrefix: data.repoContentPrefix,
    mcp: { weeglooUrl: data.mcp.weeglooUrl, uploadApiUrl: data.mcp.uploadApiUrl },
    skills,
    rules,
  };
}

/**
 * Loads ref-scoped resources (skill/rule content + MCP URLs) from the branch-committed
 * manifest in a single raw request (no api.github.com), normalized. Install code consumes
 * this shape and never touches the network — so swapping the source (e.g. a CDN mirror)
 * changes nothing downstream. See ADR D6 (ResourceSource).
 *
 * Returns null when the manifest is unavailable or invalid (404, network error, bad JSON,
 * unsupported schemaVersion) so the caller can fail fast rather than install a degraded set.
 *
 * @param {string} ref
 * @returns {Promise<{ source: string, repoContentPrefix: string, mcp: {weeglooUrl:string, uploadApiUrl:string}, skills: Array<{id:string, files:Record<string,string>}>, rules: Array<{id:string, content:string}> } | null>}
 */
export async function loadResources(ref) {
  const url = `${RAW_BASE}/${ref}/${PLUGIN_PACKAGE_ROOT}/installer-manifest.json`;
  try {
    const res = await httpGet(url, { retry: 2 });
    if (!res.ok) return null;
    return normalizeManifest(await res.json());
  } catch {
    return null;
  }
}
