/**
 * Self-update wiring. Two concerns, split by how often they change:
 *
 *  1. Per-install, immutable data (the version-check endpoint URL + the exact update command +
 *     the throttle-stamp path + the check interval) is baked straight into the `weegloo-version`
 *     rule's text at install time. Rules are auto-loaded into the agent's context every session,
 *     so the agent already knows them — no file read needed for these.
 *
 *  2. Mutable state — WHEN the version was last checked, and WHICH version is installed — lives in
 *     a small JSON stamp under .weegloo/version-check.json, at the SAME scope the user installed
 *     at (global → ~/.weegloo, project → <project>/.weegloo) so the stamp tracks alongside the
 *     scoped rule that reads it. The rule checks once per session (on the first Weegloo request)
 *     and, in a session that stays alive past the interval, again every VERSION_CHECK_INTERVAL_HOURS;
 *     it compares the stamp's `version` against the live endpoint and writes the current timestamp
 *     (preserving `version`) back after a check.
 *
 * The placeholders below live in the rule's source `.mdc`; values are substituted here, per
 * install, so the repo source stays clean and its content hash stays stable.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { VERSION_URL } from './github.js';

export const SELF_UPDATE_RULE_ID = 'weegloo-version';

/**
 * Rules that must ALWAYS be installed — excluded from the interactive picker and merged into
 * every install (the update flow re-adds them too). Two ids, two distinct reasons:
 *  - weegloo-version: self-referential — this rule IS the update notifier, so deselecting it
 *    would permanently sever the update path (nothing left to ever prompt a reinstall).
 *  - weegloo-terms-consent: the terms gate is enforced client-side by this rule, so removing
 *    it removes the gate itself (an operator/legal requirement, not a user preference).
 * weegloo-global-rules is deliberately NOT here: without it the agent merely handles Weegloo
 * less well — nothing structural breaks — so opting out stays a valid power-user choice.
 */
export const CORE_RULE_IDS = [SELF_UPDATE_RULE_ID, 'weegloo-terms-consent'];

/**
 * Splits a manifest rule list into forced-core vs user-selectable, preserving manifest order.
 * A core id missing from the manifest (an old branch that predates that rule) is simply
 * absent from `core` — nothing is invented.
 *
 * @param {Array<{id:string, content:string}>} rules
 * @returns {{ core: Array<{id:string, content:string}>, optional: Array<{id:string, content:string}> }}
 */
export function partitionCoreRules(rules) {
  const coreSet = new Set(CORE_RULE_IDS);
  return {
    core: rules.filter((r) => coreSet.has(r.id)),
    optional: rules.filter((r) => !coreSet.has(r.id)),
  };
}

/**
 * Hours between version checks WITHIN a single long-running session. The check otherwise runs
 * once per session (on the first Weegloo request); this is the extra re-check cadence for a
 * session that stays alive longer than this. There is intentionally NO cross-session calendar
 * throttle — every new session checks.
 */
export const VERSION_CHECK_INTERVAL_HOURS = 4;

/**
 * The exact command the rule tells the user to run to update. `weegloo@latest` pins the installer
 * itself to the newest release; `--no-mcp --yes` refreshes ONLY skills + rules, fully unattended
 * (no token prompt) — the weegloo MCP is a remote server that is always current, so it needs no
 * reinstall. Reuses the same ref/scope the user installed from so a pinned version stays pinned.
 * @param {{ agent: string, ref: string, scope: string }} ctx
 */
export function buildUpdateCommand({ agent, ref, scope }) {
  return `npx weegloo@latest --agent ${agent} --branch ${ref} --location ${scope} --no-mcp --yes`;
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
 * Current local time as an ISO-8601 datetime `YYYY-MM-DDTHH:mm:ss` (no timezone suffix). The
 * rule reasons about "now" in local time too, so keeping both local makes the in-session hour
 * delta consistent. Second precision is plenty for the multi-hour re-check window.
 */
export function isoNow(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  );
}

/** Stamp payload: the last-check timestamp — the rule's in-session re-check anchor. */
export function buildStamp(lastCheck) {
  return { last_check: lastCheck };
}

/** Reads and parses a small JSON file (stamp or record), or {} when absent/unreadable/corrupt. */
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Writes the version stamp: the currently-installed `version` (fetched from the version endpoint
 * at install time) that the rule later compares against the live endpoint, plus a `last_check`
 * timestamp. Called on every install and update. Best-effort: never throws — a failed stamp must
 * not fail the install. Returns the path written, or null on failure.
 *
 * NOTE: version-check.json is ALSO rewritten by the weegloo-version RULE on each check (it updates
 * `last_check`, preserving `version`). The installed-skills/rules record must NOT live here — it
 * lives in a separate, installer-only file; see getInstalledRecordPath / writeInstalledRecord.
 *
 * @param {'global'|'project'} [scope]  install scope → which .weegloo dir to write
 * @param {string} [now]        ISO-8601 local datetime; defaults to now
 * @param {string} [stampPath]  override for tests
 * @param {string|null} [version]  installed version to persist (omitted from the stamp when null)
 */
export function writeVersionStamp(
  scope = 'global',
  now = isoNow(),
  stampPath = getVersionStampPath(scope),
  version = null
) {
  try {
    const stamp = { ...buildStamp(now) };
    if (version != null) stamp.version = version;
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf-8');
    return stampPath;
  } catch {
    return null;
  }
}

/**
 * Where the installer records the skills/rules it installed — a file DISTINCT from the
 * version-check.json throttle stamp. The weegloo-version rule overwrites that stamp with
 * `{ last_check }` on every check, so keeping the record separate is what lets it survive across
 * update cycles. Same scope layout as the stamp (global → ~/.weegloo, project → <project>/.weegloo).
 *
 * @param {'global'|'project'} [scope]
 * @param {string} [cwd]  project root for project scope (defaults to process.cwd())
 */
export function getInstalledRecordPath(scope = 'global', cwd = process.cwd()) {
  return scope === 'project'
    ? path.join(cwd, '.weegloo', 'installed.json')
    : path.join(os.homedir(), '.weegloo', 'installed.json');
}

/**
 * The record of the skills/rules this scope last installed. Missing or malformed → empty lists
 * (a pre-record install, or a hand-broken file), which makes the very first record-capable run a
 * safe no-op until a record exists.
 *
 * @param {'global'|'project'} [scope]
 * @param {string} [recordPath]  override for tests
 * @returns {{ skills: string[], rules: string[] }}
 */
export function readInstalledRecord(scope = 'global', recordPath = getInstalledRecordPath(scope)) {
  const s = readJsonFile(recordPath);
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return { skills: list(s.skills), rules: list(s.rules) };
}

/**
 * Persists the installer's skills/rules record. Best-effort (never throws). Merges over any
 * existing file, so a run that manages only one kind (e.g. --ignore-rule) preserves the other
 * kind's list. Returns the path written, or null on failure.
 *
 * @param {'global'|'project'} [scope]
 * @param {{ skills?: string[], rules?: string[] }} [record]
 * @param {string} [recordPath]  override for tests
 */
export function writeInstalledRecord(scope = 'global', record = {}, recordPath = getInstalledRecordPath(scope)) {
  try {
    const next = { ...readJsonFile(recordPath) };
    if (Array.isArray(record.skills)) next.skills = record.skills;
    if (Array.isArray(record.rules)) next.rules = record.rules;
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return recordPath;
  } catch {
    return null;
  }
}

/**
 * Reconciles the on-disk skills/rules with the current install, then persists the record and
 * re-stamps the version check (last_check + version). For each MANAGED kind it removes the ids we recorded installing
 * last time but are NOT installing now — i.e. deleted upstream OR deselected this run
 * (`prevRecord \ installedNow`) — delegating the actual deletion to an agent-specific callback
 * (skill dirs / rule files / rule markers) so this stays free of filesystem-layout knowledge. A
 * kind that is NOT being managed this run (MCP-only, or --ignore-skill / --ignore-rule) is left
 * untouched: nothing is removed and its prior record is preserved verbatim.
 *
 * The record is written to installed.json; the throttle stamp is written to the rule-owned
 * version-check.json. Keeping them in separate files is deliberate — the weegloo-version rule
 * periodically overwrites the stamp, and that must never wipe the record.
 *
 * @param {{
 *   scope: 'global'|'project',
 *   now?: string,
 *   stampPath?: string,
 *   recordPath?: string,
 *   version?: string|null,
 *   manageSkills: boolean,
 *   installedSkillIds?: string[],
 *   removeSkills?: (staleIds: string[]) => string[],
 *   manageRules: boolean,
 *   installedRuleIds?: string[],
 *   removeRules?: (staleIds: string[]) => string[],
 * }} args
 * @returns {{ removedSkills: string[], removedRules: string[], stampPath: string|null, recordPath: string|null }}
 */
export function syncInstalledRecord({
  scope,
  now = isoNow(),
  stampPath = getVersionStampPath(scope),
  recordPath = getInstalledRecordPath(scope),
  version = null,
  manageSkills,
  installedSkillIds = [],
  removeSkills = () => [],
  manageRules,
  installedRuleIds = [],
  removeRules = () => [],
}) {
  const prev = readInstalledRecord(scope, recordPath);
  const nowSkills = new Set(installedSkillIds);
  const nowRules = new Set(installedRuleIds);

  const removedSkills = manageSkills
    ? removeSkills(prev.skills.filter((id) => !nowSkills.has(id)))
    : [];
  const removedRules = manageRules
    ? removeRules(prev.rules.filter((id) => !nowRules.has(id)))
    : [];

  const recordWritten = writeInstalledRecord(
    scope,
    {
      skills: manageSkills ? installedSkillIds : prev.skills,
      rules: manageRules ? installedRuleIds : prev.rules,
    },
    recordPath
  );
  const stampWritten = writeVersionStamp(scope, now, stampPath, version);

  return {
    removedSkills,
    removedRules,
    stampPath: stampWritten,
    recordPath: recordWritten,
  };
}

/**
 * Returns a copy of `rules` with the version rule's placeholders resolved for THIS install.
 * Non-version rules pass through untouched; if the rule isn't present the list is unchanged.
 * The installed version is NOT baked here — the rule reads it from version-check.json at runtime
 * (the installer writes it there via writeVersionStamp), so it can change without re-baking.
 *
 * @param {Array<{id:string, content:string}>} rules
 * @param {{ agent: string, ref: string, scope: string }} ctx
 * @returns {Array<{id:string, content:string}>}
 */
export function applySelfUpdateTemplate(rules, { agent, ref, scope }) {
  return rules.map((rule) => {
    if (rule.id !== SELF_UPDATE_RULE_ID) return rule;
    const content = rule.content
      .replaceAll('{{WEEGLOO_VERSION_URL}}', VERSION_URL)
      .replaceAll('{{WEEGLOO_UPDATE_COMMAND}}', buildUpdateCommand({ agent, ref, scope }))
      .replaceAll('{{WEEGLOO_STAMP_PATH}}', ruleStampPath(scope))
      .replaceAll('{{WEEGLOO_CHECK_INTERVAL_HOURS}}', String(VERSION_CHECK_INTERVAL_HOURS));
    return { ...rule, content };
  });
}
