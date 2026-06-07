#!/usr/bin/env node
/**
 * Builds `plugins/weegloo/installer-manifest.json` — the branch-native manifest
 * that the installer CLI (`npx weegloo`) consumes in a SINGLE
 * `raw.githubusercontent.com` request (no `api.github.com` → no REST rate limit).
 *
 * The manifest is a PURE FUNCTION of repo content (no timestamps / commit shas):
 * otherwise the regenerate-on-push workflow's `git diff --quiet` idempotence guard
 * would never hold and every push would pile up empty commits. File/skill/rule
 * order is sorted so output is identical across platforms and CI runs.
 *
 * See installer-cli/docs/0001-skill-rule-distribution.md (D2, D4).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_MCP_URL = 'https://ai.weegloo.com/mcp';
const DEFAULT_UPLOAD_API_URL = 'https://upload.weegloo.com/v1';

/** Bytewise comparator — locale/ICU-independent so manifest order is identical everywhere. */
const byteCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Reads a file as UTF-8 text, throwing if it is binary / non-UTF-8 (not embeddable as JSON). */
function readEmbeddableText(filePath) {
  const buf = readFileSync(filePath);
  if (buf.includes(0)) {
    throw new Error(`binary file (NUL byte) cannot be embedded in manifest: ${filePath}`);
  }
  const text = buf.toString('utf-8');
  // Invalid UTF-8 round-trips with replacement chars → byte length changes.
  if (Buffer.byteLength(text, 'utf-8') !== buf.length) {
    throw new Error(`non-UTF-8 file cannot be embedded in manifest: ${filePath}`);
  }
  return text;
}

function listDirsSorted(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byteCompare);
}

function buildSkills(skillsDir) {
  return listDirsSorted(skillsDir).map((id) => {
    const skillDir = path.join(skillsDir, id);
    const files = {};
    const names = readdirSync(skillDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort(byteCompare);
    for (const name of names) {
      files[name] = readEmbeddableText(path.join(skillDir, name));
    }
    // Mirror the installer's strict invariants: a manifest the consumer would reject
    // must fail the build here, not get committed and brick every install on this branch.
    if (Object.keys(files).length === 0) {
      throw new Error(`skill '${id}' has no files — installer would reject this manifest`);
    }
    return { id, files };
  });
}

function buildRules(rulesDir) {
  if (!existsSync(rulesDir)) return [];
  return readdirSync(rulesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mdc'))
    .map((e) => e.name.replace(/\.mdc$/, ''))
    .sort(byteCompare)
    .map((id) => {
      const content = readEmbeddableText(path.join(rulesDir, `${id}.mdc`));
      if (!content) {
        throw new Error(`rule '${id}' is empty — installer would reject this manifest`);
      }
      return { id, content };
    });
}

/** Extracts the weegloo MCP URLs from the branch's `.mcp.json`, falling back to defaults. */
function buildMcp(contentRoot, rootDir) {
  const candidates = [
    path.join(contentRoot, '.mcp.json'),
    path.join(rootDir, '.mcp.json'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    // A file that exists but cannot be parsed is a repo error — fail the build
    // loudly rather than silently committing a manifest with default URLs (which
    // would, e.g., switch a dev branch's MCP config to production). Defaults apply
    // only when NO .mcp.json exists at all.
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (err) {
      throw new Error(`invalid JSON in ${file}: ${err.message}`);
    }
    const servers = data?.mcpServers ?? {};
    const weeglooUrl =
      typeof servers.weegloo?.url === 'string' ? servers.weegloo.url : DEFAULT_MCP_URL;
    const uploadEnv = servers['weegloo-upload']?.env ?? {};
    const uploadApiUrl =
      typeof uploadEnv.UPLOAD_API_URL === 'string'
        ? uploadEnv.UPLOAD_API_URL
        : DEFAULT_UPLOAD_API_URL;
    return { weeglooUrl, uploadApiUrl };
  }
  return { weeglooUrl: DEFAULT_MCP_URL, uploadApiUrl: DEFAULT_UPLOAD_API_URL };
}

/**
 * @param {{ rootDir: string, contentPrefix?: string }} opts
 * @returns {{ schemaVersion: number, repoContentPrefix: string, mcp: object, skills: object[], rules: object[] }}
 */
export function buildManifest({ rootDir, contentPrefix = 'plugins/weegloo' }) {
  const contentRoot = path.join(rootDir, contentPrefix);
  return {
    schemaVersion: SCHEMA_VERSION,
    repoContentPrefix: contentPrefix,
    mcp: buildMcp(contentRoot, rootDir),
    skills: buildSkills(path.join(contentRoot, 'skills')),
    rules: buildRules(path.join(contentRoot, 'rules')),
  };
}

export function manifestOutputPath(rootDir, contentPrefix = 'plugins/weegloo') {
  return path.join(rootDir, contentPrefix, 'installer-manifest.json');
}

/** Serialize deterministically (trailing newline for clean diffs). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// CLI entry: write the manifest to disk.
if (import.meta.url === `file://${process.argv[1]}`) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(__dirname, '..');
  const contentPrefix = 'plugins/weegloo';
  const manifest = buildManifest({ rootDir, contentPrefix });
  const out = manifestOutputPath(rootDir, contentPrefix);
  writeFileSync(out, serializeManifest(manifest), 'utf-8');
  console.error(
    `installer-manifest.json: ${manifest.skills.length} skills, ${manifest.rules.length} rules → ${path.relative(rootDir, out)}`
  );
}
