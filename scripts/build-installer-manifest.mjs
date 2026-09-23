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
 * Bodies are embedded verbatim (LF-normalized) with ONE exception: a `country:` line in a
 * SKILL.md's or a rule's frontmatter. The builder validates it, removes it from the embedded
 * text and records it as the entry's structured `country` field (`{ include: [...] }` |
 * `{ exclude: [...] }`), so the installer filters on data and never parses frontmatter.
 * The field is written ONLY when it restricts something — an untagged, empty or `"*"` entry has no
 * `country` key — so a corpus with no tags builds the same bytes it did before tags existed.
 * Grammar and rationale: installer-cli/src/country.js.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The installer owns the authoritative definition of a safe skill file key; importing it
// keeps the build-time and install-time checks from drifting apart.
import { SAFE_REL_PATH } from '../installer-cli/src/io.js';
// Same reasoning for the country tag: the grammar the builder accepts and the spec shape the
// installer validates come from one module, so the two cannot disagree about what a tag means.
import { extractCountryTag, findCountryReferenceGaps } from '../installer-cli/src/country.js';
import { CORE_RULE_IDS } from '../installer-cli/src/self-update.js';

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
  // Normalize CRLF → LF before embedding. `.gitattributes` gives the working tree CRLF on
  // Windows while CI checks out LF, so without this the "pure function of repo content"
  // contract in the header is false across platforms: a local regeneration rewrites every
  // embedded string AND moves the content version hash, purely because of line endings.
  // CI already produces LF, so this changes nothing for installed users — it only stops a
  // Windows regeneration from producing a spurious whole-file diff.
  return text.replace(/\r\n/g, '\n');
}

function listDirsSorted(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byteCompare);
}

/**
 * Every file under a skill directory, as POSIX-relative keys (`references/deep.md`).
 *
 * This walk is RECURSIVE on purpose. It used to be a flat `readdirSync(...).filter(isFile)`,
 * which dropped any subdirectory WITHOUT WARNING: a skill split into `SKILL.md` +
 * `references/*.md` produced a byte-identical manifest, a green CI, and an install in which
 * the spine pointed at files that were never written to the user's disk. Nothing failed
 * loudly anywhere along that path — which is why `manifest.test.js` also asserts that a
 * skill with a subdirectory yields nested keys.
 *
 * Keys always use `/`, never the platform separator, so a manifest built on Windows installs
 * identically to one built in CI.
 */
function listSkillFilesSorted(skillDir) {
  const out = [];
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => byteCompare(a.name, b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, key);
      else if (entry.isFile()) out.push({ key, full });
      // Anything that is neither (a symlink, a socket) is skipped: it has no embeddable text.
    }
  };
  walk(skillDir, '');
  return out.sort((a, b) => byteCompare(a.key, b.key));
}

/**
 * A manifest entry with the key order `id, country?, <body>`. `country` is present only when it
 * restricts something (null = every country → no key), which is what keeps an untagged corpus's
 * manifest byte-identical to one built before country tags existed.
 */
function entry(id, country, body) {
  return country ? { id, country, ...body } : { id, ...body };
}

function buildSkills(skillsDir) {
  return listDirsSorted(skillsDir).map((id) => {
    const skillDir = path.join(skillsDir, id);
    const label = `skill '${id}'`;
    let country = null;
    const files = {};
    for (const { key, full } of listSkillFilesSorted(skillDir)) {
      // Defense in depth: the installer re-validates every key before it becomes a path,
      // but a manifest that could escape its skill directory must never be committed either.
      if (!SAFE_REL_PATH.test(key)) {
        throw new Error(`skill file key is not a safe relative path: '${key}' (in ${skillDir})`);
      }
      const text = readEmbeddableText(full);
      if (key === 'SKILL.md') {
        const tag = extractCountryTag(text, label);
        country = tag.country;
        files[key] = tag.text;
        continue;
      }
      // The tag is read from SKILL.md ONLY. A `country:` line anywhere else (a reference page's
      // frontmatter, a nested SKILL.md) would be embedded as text and never become a filter —
      // its author believes the skill is restricted while it installs everywhere. Compare the
      // text rather than the parsed value so even a no-op `"*"` there is refused: the line
      // is in the wrong file either way.
      let stray;
      try {
        stray = extractCountryTag(text, label).text !== text;
      } catch {
        // An invalid or look-alike tag in the wrong file is still a tag in the wrong file —
        // report where it belongs rather than how to fix a line that has to move anyway.
        stray = true;
      }
      if (stray) {
        throw new Error(
          `${label} file '${key}': 'country:' belongs in SKILL.md frontmatter — a tag in any other file is never read`
        );
      }
      files[key] = text;
    }
    // Mirror the installer's strict invariants: a manifest the consumer would reject
    // must fail the build here, not get committed and brick every install on this branch.
    if (Object.keys(files).length === 0) {
      throw new Error(`skill '${id}' has no files — installer would reject this manifest`);
    }
    return entry(id, country, { files });
  });
}

function buildRules(rulesDir) {
  if (!existsSync(rulesDir)) return [];
  const core = new Set(CORE_RULE_IDS);
  return readdirSync(rulesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mdc'))
    .map((e) => e.name.replace(/\.mdc$/, ''))
    .sort(byteCompare)
    .map((id) => {
      const { country, text: content } = extractCountryTag(
        readEmbeddableText(path.join(rulesDir, `${id}.mdc`)),
        `rule '${id}'`
      );
      // Checked on the STRIPPED text: the tag is not content, and the installer sees only what
      // is embedded.
      if (!content) {
        throw new Error(`rule '${id}' is empty — installer would reject this manifest`);
      }
      // The installer force-installs these (the update notifier, the terms gate) and exempts
      // them from the country filter as a second lock. A tag on one would be a promise the
      // installer deliberately breaks, so it is refused here, where the author can see it.
      if (country && core.has(id)) {
        throw new Error(`core rule '${id}' is force-installed and cannot be country-restricted`);
      }
      return entry(id, country, { content });
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
 * Short, deterministic fingerprint of the embedded content (mcp + skills + rules).
 * It is a PURE FUNCTION of repo content — no timestamps / shas — so the regenerate-on-push
 * idempotence guard (`git diff --quiet`) still holds: identical content ⇒ identical version.
 * The value changes iff the installed skills/rules/mcp change, which is exactly the signal
 * the self-update flow needs (installer records it; the `weegloo-self-update` rule compares
 * it against the branch's latest). Unrelated commits (e.g. README) do NOT move it.
 * A `country:` tag is hashed as the entry's structured `country` field (its line is stripped
 * from the body), so retagging a skill or rule — and nothing else — still moves it: which
 * countries get a file is part of what is installed.
 */
function contentVersion(content) {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

/**
 * @param {{ rootDir: string, contentPrefix?: string }} opts
 * @returns {{ schemaVersion: number, version: string, repoContentPrefix: string, mcp: object, skills: object[], rules: object[] }}
 */
export function buildManifest({ rootDir, contentPrefix = 'plugins/weegloo' }) {
  const contentRoot = path.join(rootDir, contentPrefix);
  const mcp = buildMcp(contentRoot, rootDir);
  const skills = buildSkills(path.join(contentRoot, 'skills'));
  const rules = buildRules(path.join(contentRoot, 'rules'));
  return {
    schemaVersion: SCHEMA_VERSION,
    version: contentVersion({ mcp, skills, rules }),
    repoContentPrefix: contentPrefix,
    mcp,
    skills,
    rules,
  };
}

export function manifestOutputPath(rootDir, contentPrefix = 'plugins/weegloo') {
  return path.join(rootDir, contentPrefix, 'installer-manifest.json');
}

/** Serialize deterministically (trailing newline for clean diffs). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The build's country report, as stderr lines (empty when nothing is country-restricted).
 *
 * A country filter removes a whole skill/rule, but not the lines ELSEWHERE that name it — the
 * router, `weegloo-global-rules` — so in a country where the target is not installed an agent is
 * routed to something that is not on disk. That is fine only if the naming line is actionable
 * without its target (CLAUDE.md §1.3-4), which only a person can judge: hence warnings for the
 * author, never a build failure.
 *
 * @param {{ skills: object[], rules: object[] }} manifest
 * @returns {string[]}
 */
export function countryReport(manifest) {
  const restrictedSkills = manifest.skills.filter((s) => s.country).length;
  const restrictedRules = manifest.rules.filter((r) => r.country).length;
  if (restrictedSkills === 0 && restrictedRules === 0) return [];
  const lines = [`country-restricted: ${restrictedSkills} skill(s), ${restrictedRules} rule(s)`];
  const gaps = findCountryReferenceGaps(manifest);
  if (gaps.length > 0) {
    lines.push(`WARNING: ${gaps.length} reference(s) to a country-restricted skill/rule from where it is not installed:`);
    for (const g of gaps) {
      lines.push(`  ${g.from} names ${g.to}, but is installed where ${g.to} is not (${g.fromCountry} ⊄ ${g.toCountry})`);
    }
    lines.push(
      '  Each referencing line must stay actionable without its target in those countries (CLAUDE.md §1.3-4).'
    );
  }
  return lines;
}

// CLI entry: write the manifest to disk.
// Use pathToFileURL so the comparison holds on Windows too (where process.argv[1]
// is a backslash path that never matches a hand-built `file://` string).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(__dirname, '..');
  const contentPrefix = 'plugins/weegloo';
  const manifest = buildManifest({ rootDir, contentPrefix });
  const out = manifestOutputPath(rootDir, contentPrefix);
  writeFileSync(out, serializeManifest(manifest), 'utf-8');
  console.error(
    `installer-manifest.json: ${manifest.skills.length} skills, ${manifest.rules.length} rules → ${path.relative(rootDir, out)}`
  );
  // Report only — the manifest is already written and the exit code stays 0 (see countryReport).
  for (const line of countryReport(manifest)) console.error(line);
}
