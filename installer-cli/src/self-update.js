/**
 * Self-update wiring. Two concerns, split by how often they change:
 *
 *  1. Per-install, immutable data (installed version + the exact refresh command + the
 *     manifest URL + the throttle-stamp path) is baked straight into the `weegloo-version`
 *     rule's text at install time. Rules are auto-loaded into the agent's context every
 *     session, so the agent already knows them — no file read needed for these.
 *
 *  2. Mutable throttle state — WHEN the version was last checked — lives in a small JSON
 *     stamp under .weegloo/version-check.json, at the SAME scope the user installed at
 *     (global → ~/.weegloo, project → <project>/.weegloo) so the stamp tracks alongside the
 *     scoped rule that reads it. The rule applies a 14-day window (so a company behind one
 *     NAT IP can't burst GitHub right after a mass install, and a declined prompt stays quiet
 *     for two weeks), and writes today's date back after a check.
 *
 * The placeholders below live in the rule's source `.mdc`; values are substituted here, per
 * install, so the repo source stays clean and its content hash stays stable.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { REPO, PLUGIN_PACKAGE_ROOT } from './github.js';

export const SELF_UPDATE_RULE_ID = 'weegloo-version';

/** Days the version check stays quiet after an install / update / decline. */
export const VERSION_CHECK_INTERVAL_DAYS = 14;

/** The raw URL the agent fetches to learn the branch's latest content version. */
export function buildManifestUrl(ref) {
  return `https://raw.githubusercontent.com/${REPO}/${ref}/${PLUGIN_PACKAGE_ROOT}/installer-manifest.json`;
}

/**
 * The exact command that refreshes skills/rules only (no MCP, so no token needed) for THIS
 * install. Reuses the same ref/scope the user installed from so a pinned version stays pinned.
 * @param {{ agent: string, ref: string, scope: string }} ctx
 */
export function buildUpdateCommand({ agent, ref, scope }) {
  return `npx weegloo --agent ${agent} --branch ${ref} --location ${scope} --no-mcp --yes`;
}

/**
 * Where the throttle stamp lives — the SAME scope the user chose for skills/rules:
 *   global  → ~/.weegloo/version-check.json          (one per user; shared by global installs)
 *   project → <project>/.weegloo/version-check.json  (independent per project)
 * Returns an absolute path (the installer writes here). The path BAKED INTO the rule is
 * project-relative for project scope — see ruleStampPath — so it survives a project move.
 *
 * @param {'global'|'project'} [scope]
 * @param {string} [cwd]  project root for project scope (defaults to process.cwd())
 */
export function getVersionStampPath(scope = 'global', cwd = process.cwd()) {
  return scope === 'project'
    ? path.join(cwd, '.weegloo', 'version-check.json')
    : path.join(os.homedir(), '.weegloo', 'version-check.json');
}

/** The stamp path written INTO the rule text: project-relative (resolved vs the project root). */
function ruleStampPath(scope) {
  return scope === 'project' ? '.weegloo/version-check.json' : getVersionStampPath('global');
}

/**
 * Today's date as YYYY-MM-DD in the user's LOCAL timezone (not UTC). The agent reasons about
 * "today" locally too, so keeping both local avoids an off-by-one on the 14-day window.
 */
export function isoToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Stamp payload: just the last-check date — the rule's 14-day window anchor. */
export function buildStamp(today) {
  return { last_check: today };
}

/**
 * Initializes / refreshes the throttle stamp so the 14-day window restarts now. Called on
 * every install and update, which is exactly the post-install / post-update grace we want.
 * Best-effort: never throws — a failed stamp must not fail the install (the rule degrades to
 * the install-time grace baked elsewhere). Returns the path written, or null on failure.
 *
 * @param {'global'|'project'} [scope]  install scope → which .weegloo dir to write
 * @param {string} [today]      ISO date; defaults to today
 * @param {string} [stampPath]  override for tests
 */
export function writeVersionStamp(scope = 'global', today = isoToday(), stampPath = getVersionStampPath(scope)) {
  try {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, `${JSON.stringify(buildStamp(today), null, 2)}\n`, 'utf-8');
    return stampPath;
  } catch {
    return null;
  }
}

/**
 * Returns a copy of `rules` with the version rule's placeholders resolved for THIS install.
 * Non-version rules pass through untouched; if the rule isn't present the list is unchanged.
 * A null/empty `version` (older manifest with no fingerprint) becomes `unknown`, which the
 * rule treats as "skip the check".
 *
 * @param {Array<{id:string, content:string}>} rules
 * @param {{ version: string|null, agent: string, ref: string, scope: string }} ctx
 * @returns {Array<{id:string, content:string}>}
 */
export function applySelfUpdateTemplate(rules, { version, agent, ref, scope }) {
  return rules.map((rule) => {
    if (rule.id !== SELF_UPDATE_RULE_ID) return rule;
    const content = rule.content
      .replaceAll('{{WEEGLOO_INSTALLED_VERSION}}', version || 'unknown')
      .replaceAll('{{WEEGLOO_MANIFEST_URL}}', buildManifestUrl(ref))
      .replaceAll('{{WEEGLOO_UPDATE_COMMAND}}', buildUpdateCommand({ agent, ref, scope }))
      .replaceAll('{{WEEGLOO_STAMP_PATH}}', ruleStampPath(scope))
      .replaceAll('{{WEEGLOO_CHECK_INTERVAL_DAYS}}', String(VERSION_CHECK_INTERVAL_DAYS));
    return { ...rule, content };
  });
}
