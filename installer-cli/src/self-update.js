/**
 * Self-update wiring. Two concerns, split by how often they change:
 *
 *  1. Per-install, immutable data (the branch-scoped version-check URL + the exact update
 *     command + the throttle-stamp path + the check interval) is baked straight into the
 *     `weegloo-version` rule's text at install time. Rules are auto-loaded into the agent's
 *     context every session, so the agent already knows them — no file read needed for these.
 *
 *  2. Mutable state — WHEN the version was last checked, WHICH version is installed, and from
 *     WHICH branch — lives in a small JSON stamp under .weegloo/<agent>/version-check.json,
 *     at the SAME scope the user installed at (global → ~/.weegloo, project →
 *     <project>/.weegloo). The path is PER-AGENT: installed content is per-agent (claude may
 *     be current while cursor is stale, even on different branches), so a shared stamp cannot
 *     represent it — one agent's install would silence every other agent's staleness. The rule
 *     checks once per session (on the first Weegloo request) and, in a session that stays
 *     alive past the interval, again every VERSION_CHECK_INTERVAL_HOURS; it compares the
 *     stamp's `version` against the branch-scoped endpoint and rewrites ONLY `last_check`
 *     (preserving `version`, `ref`, and any other field) after a check.
 *
 * Legacy (pre-per-agent) installs used flat .weegloo/version-check.json + installed.json shared
 * by every agent. Those paths are no longer written: keeping the flat stamp fresh would make
 * not-yet-migrated agents' old rules misread it as "current" and never prompt the update that
 * migrates them. The flat installed.json IS still read once per agent — see syncInstalledRecord.
 *
 * The placeholders below live in the rule's source `.mdc`; values are substituted here, per
 * install, so the repo source stays clean and its content hash stays stable.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { VERSION_URL } from './github.js';
import { listWeeglooRuleFiles } from './io.js';

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
 * The exact command the rule tells the user to run to update. Deliberately MINIMAL:
 * `weegloo@latest` pins the INSTALLER to its newest release; `--update` runs the update flow,
 * which — unlike an install — preserves the user's skill/rule selection (from the per-agent
 * record), auto-adds genuinely new items, prunes upstream-deleted ones, and never touches MCP
 * config (so no token). No `--branch`: the update reads the branch from the agent's own stamp
 * `ref` (falling back to latest), so the command needs no per-branch variant — `--branch` stays
 * available as an explicit override / branch switch. No `--yes`: update mode has nothing to
 * prompt for, and suppressing prompts would also mute the rare shared-store conflict question
 * a human at a TTY should get to answer.
 * @param {{ agent: string, scope: string }} ctx
 */
export function buildUpdateCommand({ agent, scope }) {
  return `npx weegloo@latest --agent ${agent} --location ${scope} --update`;
}

/** The `.weegloo` state directory for a scope (global → home, project → project root). */
function weeglooStateDir(scope = 'global', cwd = process.cwd()) {
  return scope === 'project' ? path.join(cwd, '.weegloo') : path.join(os.homedir(), '.weegloo');
}

/**
 * Where the throttle stamp lives — the SAME scope the user chose for skills/rules, and
 * PER-AGENT (installed content diverges per agent, so the version signal must too):
 *   global  → ~/.weegloo/<agent>/version-check.json
 *   project → <project>/.weegloo/<agent>/version-check.json
 * Returns an absolute path (the installer writes here). The path BAKED INTO the rule is
 * project-relative for project scope — see ruleStampPath — so it survives a project move.
 *
 * @param {'global'|'project'} [scope]
 * @param {string} agent  the target agent id ('claude', 'cursor', …) — required
 * @param {string} [cwd]  project root for project scope (defaults to process.cwd())
 */
export function getVersionStampPath(scope = 'global', agent, cwd = process.cwd()) {
  return path.join(weeglooStateDir(scope, cwd), agent, 'version-check.json');
}

/** The stamp path written INTO the rule text: project-relative (resolved vs the project root). */
function ruleStampPath(scope, agent) {
  return scope === 'project'
    ? `.weegloo/${agent}/version-check.json`
    : getVersionStampPath('global', agent);
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

/**
 * Stamp payload. `last_check` is the rule's in-session re-check anchor; `version` is the
 * INSTALLED content version the rule compares against the endpoint; `ref` is the branch this
 * agent installed from — the only structured record of it (the update flow reads it back).
 * null/absent version/ref are omitted (a legacy-shaped stamp stays legacy-shaped).
 */
export function buildStamp(lastCheck, version = null, ref = null) {
  const stamp = { last_check: lastCheck };
  if (version != null) stamp.version = version;
  if (ref != null) stamp.ref = ref;
  return stamp;
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
 * Writes the version stamp: the installed `version` (this branch's manifest version — NOT the
 * global latest, or a non-latest install would mis-compare forever), the `ref` (branch) it came
 * from, and the `last_check` timestamp. Called on every install and update. Best-effort: never
 * throws — a failed stamp must not fail the install. Returns the path written, or null on failure.
 *
 * NOTE: version-check.json is ALSO rewritten by the weegloo-version RULE on each check (it updates
 * `last_check`, preserving every other field). The installed-skills/rules record must NOT live
 * here — it lives in a separate, installer-only file; see getInstalledRecordPath.
 *
 * @param {string} stampPath  absolute stamp path (per-agent — see getVersionStampPath)
 * @param {{ now?: string, version?: string|null, ref?: string|null }} [opts]
 */
export function writeVersionStamp(stampPath, { now = isoNow(), version = null, ref = null } = {}) {
  try {
    const stamp = buildStamp(now, version, ref);
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf-8');
    return stampPath;
  } catch {
    return null;
  }
}

/**
 * Where the installer records the skills/rules it installed — a file DISTINCT from the
 * version-check.json throttle stamp. The weegloo-version rule overwrites that stamp on every
 * check, so keeping the record separate is what lets it survive across update cycles. Same
 * per-agent layout as the stamp: without it, agent B's install would rewrite agent A's record
 * and A's next reconcile would prune rules/skills A still wants (order-dependent deletion).
 *
 * @param {'global'|'project'} [scope]
 * @param {string} agent  the target agent id — required
 * @param {string} [cwd]  project root for project scope (defaults to process.cwd())
 */
export function getInstalledRecordPath(scope = 'global', agent, cwd = process.cwd()) {
  return path.join(weeglooStateDir(scope, cwd), agent, 'installed.json');
}

/**
 * The LEGACY (pre-per-agent) record path, shared by every agent of a scope. Never written
 * anymore — read exactly once per agent, as the reconcile fallback on that agent's first
 * per-agent run, so skills/rules deleted upstream since the legacy install still get pruned
 * instead of surviving as orphans that keep loading stale guidance into sessions.
 *
 * @param {'global'|'project'} [scope]
 * @param {string} [cwd]
 */
export function getLegacyInstalledRecordPath(scope = 'global', cwd = process.cwd()) {
  return path.join(weeglooStateDir(scope, cwd), 'installed.json');
}

/**
 * The record of what this agent last installed, plus the CATALOG it was offered at that time.
 * `skills`/`rules` = the user's selection; `availableSkills`/`availableRules` = every id the
 * manifest offered then. The catalog is what lets the update flow tell a genuinely NEW upstream
 * item (absent from the old catalog → auto-add) from one the user deliberately deselected
 * (present in the old catalog but not selected → respect the opt-out). Missing or malformed →
 * empty lists, which makes the first record-capable run a safe no-op.
 *
 * @param {string} recordPath
 * @returns {{ skills: string[], rules: string[], availableSkills: string[], availableRules: string[] }}
 */
export function readInstalledRecord(recordPath) {
  const s = readJsonFile(recordPath);
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    skills: list(s.skills),
    rules: list(s.rules),
    availableSkills: list(s.availableSkills),
    availableRules: list(s.availableRules),
  };
}

/**
 * Persists the installer's record. Best-effort (never throws). Merges over any existing file,
 * so a run that manages only one kind (e.g. --ignore-rule) preserves the other kind's lists.
 * Returns the path written, or null on failure.
 *
 * @param {string} recordPath
 * @param {{ skills?: string[], rules?: string[], availableSkills?: string[], availableRules?: string[] }} [record]
 */
export function writeInstalledRecord(recordPath, record = {}) {
  try {
    const next = { ...readJsonFile(recordPath) };
    for (const key of ['skills', 'rules', 'availableSkills', 'availableRules']) {
      if (Array.isArray(record[key])) next[key] = record[key];
    }
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return recordPath;
  } catch {
    return null;
  }
}

/**
 * SHARED-STORE REMOVAL GUARD. Some project-scope stores are physically shared between agents
 * (codex + antigravity both keep skills in `<cwd>/.agents/skills`; codex + androidstudio keep
 * rule markers in `<cwd>/AGENTS.md`). An agent pruning its own deselected/stale id from such a
 * store would also destroy the OTHER agent's copy — and the loss is silent: the other agent's
 * sessions just stop seeing the item, and nothing prompts its restoring update until the next
 * release ships. So before removing from a shared store, drop every id a sharer's per-agent
 * record still claims: the file stays, only this agent's record lets go. When the LAST claimer
 * deselects, no record claims it anymore and the removal really happens — a reference count,
 * with the per-agent records as the counters. A sharer without a per-agent record yet (pre-
 * migration) claims nothing here; that transitional loss still heals via its migrating update.
 *
 * @param {string[]} ids  removal candidates (this agent's prune diff)
 * @param {{ scope: 'global'|'project', sharers: string[], kind: 'skills'|'rules', cwd?: string }} args
 * @returns {string[]} ids no sharer claims (safe to remove)
 */
export function withoutSharerClaims(ids, { scope, sharers, kind, cwd = process.cwd() }) {
  if (!Array.isArray(ids) || ids.length === 0 || sharers.length === 0) return ids;
  const claimed = new Set();
  for (const sharer of sharers) {
    const record = readInstalledRecord(getInstalledRecordPath(scope, sharer, cwd));
    for (const id of record[kind]) claimed.add(id);
  }
  return ids.filter((id) => !claimed.has(id));
}

/**
 * The agents (other than `agent`) whose rule claims still pin markers in the project
 * `<cwd>/AGENTS.md`. codex and androidstudio always store rules there; antigravity only
 * PRE-switch — once it keeps rules as files in `.agents/rules/` (weegloo rule files present),
 * its record claims pin those files, not markers, and counting them would just preserve stale
 * markers everyone reads.
 *
 * @param {string} agent  the agent doing the removal (excluded from the result)
 * @param {string} [cwd]
 */
export function projectMarkerRuleSharers(agent, cwd = process.cwd()) {
  return ['codex', 'androidstudio', 'antigravity'].filter((a) => {
    if (a === agent) return false;
    if (a !== 'antigravity') return true;
    return listWeeglooRuleFiles(path.join(cwd, '.agents', 'rules'), 'md').length === 0;
  });
}

/**
 * Reconciles the on-disk skills/rules with the current install, then persists the per-agent
 * record (selection + offered catalog) and re-stamps the version check (last_check + version +
 * ref). For each MANAGED kind it removes the ids we recorded installing last time but are NOT
 * installing now — i.e. deleted upstream OR deselected this run (`prevRecord \ installedNow`) —
 * delegating the actual deletion to an agent-specific callback (skill dirs / rule files / rule
 * markers) so this stays free of filesystem-layout knowledge. A kind that is NOT being managed
 * this run (MCP-only, or --ignore-skill / --ignore-rule) is left untouched: nothing is removed
 * and its prior record is preserved verbatim.
 *
 * MIGRATION FALLBACK: when this agent has no per-agent record yet, `prev` is read once from the
 * legacy flat installed.json (shared by all agents pre-split). Without it, a migrating install
 * would see an empty prev and skills/rules deleted upstream would survive as permanent orphans —
 * stale content that agents keep loading. Safe even though the flat record may list OTHER
 * agents' ids: the removal callbacks are existence-checked inside THIS agent's own directories,
 * so foreign ids are no-ops. The legacy file itself is never written or deleted (other agents'
 * first migrations still need it as their fallback).
 *
 * The record is written to installed.json; the throttle stamp is written to the rule-owned
 * version-check.json. Keeping them in separate files is deliberate — the weegloo-version rule
 * periodically overwrites the stamp, and that must never wipe the record.
 *
 * @param {{
 *   scope: 'global'|'project',
 *   agent?: string,
 *   now?: string,
 *   stampPath?: string,
 *   recordPath?: string,
 *   legacyRecordPath?: string,
 *   version?: string|null,
 *   ref?: string|null,
 *   manageSkills: boolean,
 *   installedSkillIds?: string[],
 *   availableSkillIds?: string[],
 *   removeSkills?: (staleIds: string[]) => string[],
 *   manageRules: boolean,
 *   installedRuleIds?: string[],
 *   availableRuleIds?: string[],
 *   removeRules?: (staleIds: string[]) => string[],
 * }} args
 * @returns {{ removedSkills: string[], removedRules: string[], stampPath: string|null, recordPath: string|null }}
 */
export function syncInstalledRecord({
  scope,
  agent,
  now = isoNow(),
  stampPath = getVersionStampPath(scope, agent),
  recordPath = getInstalledRecordPath(scope, agent),
  legacyRecordPath = getLegacyInstalledRecordPath(scope),
  version = null,
  ref = null,
  manageSkills,
  installedSkillIds = [],
  availableSkillIds = [],
  removeSkills = () => [],
  manageRules,
  installedRuleIds = [],
  availableRuleIds = [],
  removeRules = () => [],
}) {
  const prev = fs.existsSync(recordPath)
    ? readInstalledRecord(recordPath)
    : readInstalledRecord(legacyRecordPath);
  const nowSkills = new Set(installedSkillIds);
  const nowRules = new Set(installedRuleIds);

  const removedSkills = manageSkills
    ? removeSkills(prev.skills.filter((id) => !nowSkills.has(id)))
    : [];
  const removedRules = manageRules
    ? removeRules(prev.rules.filter((id) => !nowRules.has(id)))
    : [];

  const recordWritten = writeInstalledRecord(recordPath, {
    skills: manageSkills ? installedSkillIds : prev.skills,
    rules: manageRules ? installedRuleIds : prev.rules,
    availableSkills: manageSkills ? availableSkillIds : prev.availableSkills,
    availableRules: manageRules ? availableRuleIds : prev.availableRules,
  });
  const stampWritten = writeVersionStamp(stampPath, { now, version, ref });

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
 * The check URL is BRANCH-SCOPED (`?branch=<ref>`): the endpoint's bare form answers for
 * `latest`, so a non-latest install comparing against it would see a permanent mismatch (or
 * miss its own branch's updates). Baking the ref into the URL means the rule needs no runtime
 * lookup to know which branch to ask about. The installed version is NOT baked here — the rule
 * reads it from the per-agent version-check.json at runtime (writeVersionStamp writes it), so
 * it can change without re-baking.
 *
 * @param {Array<{id:string, content:string}>} rules
 * @param {{ agent: string, ref: string, scope: string }} ctx
 * @returns {Array<{id:string, content:string}>}
 */
export function applySelfUpdateTemplate(rules, { agent, ref, scope }) {
  return rules.map((rule) => {
    if (rule.id !== SELF_UPDATE_RULE_ID) return rule;
    const content = rule.content
      .replaceAll('{{WEEGLOO_VERSION_URL}}', `${VERSION_URL}?branch=${encodeURIComponent(ref)}`)
      .replaceAll('{{WEEGLOO_UPDATE_COMMAND}}', buildUpdateCommand({ agent, scope }))
      .replaceAll('{{WEEGLOO_STAMP_PATH}}', ruleStampPath(scope, agent))
      .replaceAll('{{WEEGLOO_CHECK_INTERVAL_HOURS}}', String(VERSION_CHECK_INTERVAL_HOURS));
    return { ...rule, content };
  });
}
