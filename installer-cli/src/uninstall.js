/**
 * The `--uninstall` flow: put an agent back the way it was before `npx weegloo` ran. It is the
 * inverse of an install, not of an update, so it removes everything the installer created:
 *
 *  - skill directories and rule files (or rule marker sections inside a shared AGENTS.md /
 *    GEMINI.md), for the ids the per-agent record claims plus any `weegloo-*` artifact still
 *    sitting in this agent's own stores (a pre-record install left no record to read);
 *  - the `weegloo` / `weegloo-upload` MCP server entries — and with them the Personal Access
 *    Token the installer wrote into that config;
 *  - the tracking state under `.weegloo/<agent>/` (record + version stamp);
 *  - directories and context files that are left EMPTY by the above, since a leftover empty
 *    `.claude/skills/` or a BOM-only `AGENTS.md` is not "the state before the install".
 *
 * Three properties are deliberate:
 *
 *  - OFFLINE. No manifest, no branch, no token — removal is driven entirely by the record and a
 *    disk scan, so uninstalling works when the network (or the branch) is gone.
 *  - SHARED STORES ARE REFERENCE-COUNTED. `.agents/skills` and `<cwd>/AGENTS.md` are physically
 *    shared between agents, so an id another agent's record still claims is left in place and
 *    only this agent's tracking lets go of it (see self-update.js withoutSharerClaims).
 *  - NOTHING IS INFERRED ABOUT THE USER'S OWN FILES. A Codex project-trust entry, a Claude
 *    marketplace plugin, and the PAT itself were never created by this installer's file writes
 *    (or belong to the user's account), so they are reported, never deleted.
 *
 * Scope: exactly what an install touches — the chosen scope's stores. Detection can therefore
 * only see the CURRENT project and the user's home; an install made inside another project
 * folder has to be uninstalled from that folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { checkbox, confirm } from '@inquirer/prompts';

import {
  getInstalledRecordPath,
  getLegacyInstalledRecordPath,
  getVersionStampPath,
  readInstalledRecord,
  writeInstalledRecord,
  withoutSharerClaims,
  projectMarkerRuleSharers,
} from './self-update.js';
import {
  removeSkillDirs,
  removeRuleFiles,
  listWeeglooSkillDirs,
  listWeeglooRuleFiles,
  listWeeglooRuleMarkers,
} from './io.js';
import { removeRuleMarkers, stripWeeglooMcpSections, getCodexConfigPath } from './codex.js';
import { RULE_LOADING_ID } from './antigravity.js';
import { getAgentStore, agentScopes, scopeRoot, MCP_SERVER_NAMES } from './stores.js';
import { applyOriginMapping } from './origins.js';
import { AGENTS } from './cli.js';

/** Where the user revokes the Personal Access Token the installer stored in the MCP config. */
const PAT_PAGE_URL = 'https://console.weegloo.com/account/profile/personal-access-tokens';

/** Reads and parses a JSON file, or null when absent / unreadable / corrupt. */
function readJsonOrNull(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Union of two id lists, first-seen order preserved. */
function union(a, b) {
  return [...new Set([...a, ...b])];
}

/**
 * The weegloo rule ids in the agent's OWN rule store. Kept separate from the legacy scan below
 * because only this one is evidence that THIS agent was installed. `weegloo-rule-loading` is
 * excluded everywhere: it is Antigravity's own bootstrap marker (not a manifest rule), handled
 * explicitly by the antigravity branch below, and never another marker agent's to delete.
 */
function listOwnRuleIds(rules) {
  const ids =
    rules.kind === 'files'
      ? listWeeglooRuleFiles(rules.dir, rules.ext)
      : listWeeglooRuleMarkers(rules.file);
  return ids.filter((id) => id !== RULE_LOADING_ID);
}

/**
 * Rule ids a PRE-MIGRATION antigravity install left as markers in the shared `<cwd>/AGENTS.md`.
 * Removable (subject to the sharer guard), but never proof that antigravity is installed — the
 * very same markers are how codex and Android Studio store their rules.
 */
function listLegacyRuleIds(rules) {
  if (!rules.legacyMarkersFile) return [];
  return listWeeglooRuleMarkers(rules.legacyMarkersFile).filter((id) => id !== RULE_LOADING_ID);
}

/** The weegloo MCP server names currently present in an agent's MCP config. */
export function listMcpServers(mcp) {
  if (!mcp || !fs.existsSync(mcp.file)) return [];
  if (mcp.kind === 'toml') {
    let toml = '';
    try {
      toml = fs.readFileSync(mcp.file, 'utf-8');
    } catch {
      return [];
    }
    return MCP_SERVER_NAMES.filter((name) => toml.includes(`[mcp_servers.${name}]`));
  }
  const container = readJsonOrNull(mcp.file)?.[mcp.container];
  if (!container || typeof container !== 'object') return [];
  return MCP_SERVER_NAMES.filter((name) => container[name] != null);
}

/**
 * Removes the weegloo MCP server entries from one agent's config, leaving every other server —
 * and every unrelated setting in the same file — untouched.
 *
 * The FILE is never deleted, even when the removal empties it out. Nothing records whether the
 * installer created it or the user did, and guessing wrong is unrecoverable: a `.mcp.json`
 * holding only weegloo servers was deleted this way even though it was committed to the repo.
 * An empty `{}` is untidy; taking someone's tracked file is worse.
 *
 * @param {{ kind: 'json'|'toml', file: string, container?: string }} mcp
 * @returns {{ removed: string[], file: string }}
 */
export function removeMcpServers(mcp) {
  const result = { removed: [], file: mcp?.file ?? null };
  if (!mcp || !fs.existsSync(mcp.file)) return result;

  if (mcp.kind === 'toml') {
    const existing = fs.readFileSync(mcp.file, 'utf-8');
    result.removed = MCP_SERVER_NAMES.filter((name) => existing.includes(`[mcp_servers.${name}]`));
    if (result.removed.length === 0) return result;
    const stripped = stripWeeglooMcpSections(existing);
    fs.writeFileSync(mcp.file, stripped.trim() === '' ? '' : `${stripped}\n`, 'utf-8');
    return result;
  }

  const config = readJsonOrNull(mcp.file);
  const container = config?.[mcp.container];
  if (!container || typeof container !== 'object') return result;
  for (const name of MCP_SERVER_NAMES) {
    if (container[name] == null) continue;
    delete container[name];
    result.removed.push(name);
  }
  if (result.removed.length === 0) return result;
  // The emptied container key is ours to drop; the file itself is not.
  if (Object.keys(container).length === 0) delete config[mcp.container];
  fs.writeFileSync(mcp.file, JSON.stringify(config, null, 2), 'utf-8');
  return result;
}

/**
 * Removes `dir` and then each parent that the removal leaves empty, stopping at `root` (the
 * scope's install root) or at the first directory that still holds something. `fs.rmdirSync`
 * refuses a non-empty directory, so this can never take a directory that is still in use.
 *
 * @returns {string[]} directories removed, innermost first
 */
export function pruneEmptyDirs(dir, root) {
  const stop = path.resolve(root);
  let current = path.resolve(dir);
  const removed = [];
  while (current !== stop && current.startsWith(stop + path.sep)) {
    if (!fs.existsSync(current)) break;
    try {
      fs.rmdirSync(current);
    } catch {
      break; // not empty (or not ours to take) — and neither is anything above it
    }
    removed.push(current);
    current = path.dirname(current);
  }
  return removed;
}

/**
 * Removes this agent's tracking state (`.weegloo/<agent>/`). The LEGACY flat files shared by
 * every agent go only once no per-agent directory is left beside them — while another agent
 * still has one, that file is its migration fallback.
 *
 * @returns {string[]} paths removed
 */
function removeTrackingState(scope, agent, cwd) {
  const agentDir = path.dirname(getInstalledRecordPath(scope, agent, cwd));
  const stateRoot = path.dirname(agentDir);
  const removed = [];

  if (fs.existsSync(agentDir)) {
    fs.rmSync(agentDir, { recursive: true, force: true });
    removed.push(agentDir);
  }
  if (!fs.existsSync(stateRoot)) return removed;

  let entries = [];
  try {
    entries = fs.readdirSync(stateRoot, { withFileTypes: true });
  } catch {
    return removed;
  }
  if (!entries.some((e) => e.isDirectory())) {
    const legacyFiles = [
      getLegacyInstalledRecordPath(scope, cwd),
      path.join(stateRoot, 'version-check.json'), // the pre-per-agent flat stamp
    ];
    for (const file of legacyFiles) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        fs.rmSync(file, { force: true });
        removed.push(file);
      }
    }
  }
  removed.push(...pruneEmptyDirs(stateRoot, scopeRoot(scope, cwd)));
  return removed;
}

/**
 * Looks at one agent+scope and reports what a weegloo install left there. Read-only.
 *
 * THE RECORD IS THE ONLY AUTHORITY on what this installer put here. A `weegloo-*` name found on
 * disk that the record does not claim is reported as **unverified** and is never removed unless
 * the user picks it out by name: it may be the user's own file. That is not hypothetical — an
 * earlier version unioned the record with the prefix scan and deleted a repo-authored
 * `weegloo-npm-publish` project skill, because the confirmation showed only a COUNT ("1 skill")
 * and there was nothing for the user to recognize.
 *
 * `strong` distinguishes evidence that can ONLY come from installing this agent (its record, its
 * stamp, its private stores, its MCP config) from artifacts seen only in a store shared with
 * another agent — which may well be that other agent's. Weak targets are offered unchecked.
 *
 * @param {string} agent
 * @param {'global'|'project'} scope
 * @param {string} [cwd]
 */
export function detectInstall(agent, scope, cwd = process.cwd()) {
  const store = getAgentStore(agent, scope);
  if (!store) return null;

  const recordPath = getInstalledRecordPath(scope, agent, cwd);
  const stampPath = getVersionStampPath(scope, agent, cwd);
  const hasRecord = fs.existsSync(recordPath);
  const hasStamp = fs.existsSync(stampPath);
  const record = hasRecord ? readInstalledRecord(recordPath) : null;

  const diskSkills = listWeeglooSkillDirs(store.skills.dir);
  const ownRules = listOwnRuleIds(store.rules);
  const diskRules = union(ownRules, listLegacyRuleIds(store.rules));

  // Removable = exactly what the record claims (a recorded id no longer on disk is a harmless
  // no-op downstream). Everything else that merely LOOKS like ours needs the user's word.
  const skills = record?.skills ?? [];
  const rules = (record?.rules ?? []).filter((id) => id !== RULE_LOADING_ID);
  const unverifiedSkills = diskSkills.filter((id) => !skills.includes(id));
  const unverifiedRules = diskRules.filter((id) => id !== RULE_LOADING_ID && !rules.includes(id));
  const mcpServers = listMcpServers(store.mcp);

  const privateSkillEvidence = diskSkills.length > 0 && store.skills.sharedWith.length === 0;
  const privateRuleEvidence = ownRules.length > 0 && store.rules.sharedWith.length === 0;
  // Android Studio's mcp.json belongs to the IDE, not the project, so weegloo entries there say
  // nothing about THIS folder — same weak signal as a marker in a shared AGENTS.md.
  const privateMcpEvidence = mcpServers.length > 0 && !store.mcp?.ideWide;
  const strong = hasRecord || hasStamp || privateMcpEvidence || privateSkillEvidence || privateRuleEvidence;
  const present =
    strong || diskSkills.length > 0 || diskRules.length > 0 || mcpServers.length > 0;

  return {
    agent,
    scope,
    store,
    present,
    strong,
    hasRecord,
    hasStamp,
    recordPath,
    stampPath,
    origins: record?.origins ?? null,
    skills,
    rules,
    unverifiedSkills,
    unverifiedRules,
    diskSkills,
    diskRules,
    mcpServers,
  };
}

/**
 * Every install this run can see: the current project and the user's home, narrowed by a pinned
 * `--agent` / `--location`. Android Studio is project-only, so a location filter never applies
 * to it (index.js normalizes its scope the same way on install).
 *
 * @param {{ agent?: string|null, scope?: string|null, cwd?: string }} [filter]
 */
export function detectInstalls({ agent = null, scope = null, cwd = process.cwd() } = {}) {
  const found = [];
  for (const candidate of agent ? [agent] : AGENTS) {
    const scopes = agentScopes(candidate).filter(
      (s) => !scope || candidate === 'androidstudio' || s === scope
    );
    for (const candidateScope of scopes) {
      const detected = detectInstall(candidate, candidateScope, cwd);
      if (detected?.present) found.push(detected);
    }
  }
  return found;
}

/**
 * Removes one detected install. The three `remove*` toggles come from `--no-mcp` /
 * `--ignore-skill` / `--ignore-rule`, which read the same way in uninstall mode as in install
 * mode: "leave this kind alone".
 *
 * Tracking state goes only on a full skills+rules removal — nothing is left to track then. A
 * partial run instead rewrites the record with the removed kinds emptied, so a later `--update`
 * does not treat the removal as drift and restore it.
 *
 * `extraSkillIds` / `extraRuleIds` are unverified ids (see detectInstall) the user picked out by
 * name. They are the ONLY way a `weegloo-*` artifact the record does not claim gets removed.
 *
 * @param {ReturnType<typeof detectInstall>} target
 * @param {{ mcp?: boolean, skills?: boolean, rules?: boolean, extraSkillIds?: string[],
 *           extraRuleIds?: string[], cwd?: string }} [opts]
 */
export function uninstallTarget(
  target,
  { mcp = true, skills = true, rules = true, extraSkillIds = [], extraRuleIds = [], cwd = process.cwd() } = {}
) {
  const { agent, scope, store } = target;
  // Only ids this target actually offered as unverified can be opted in.
  const skillIds = union(target.skills, extraSkillIds.filter((id) => target.unverifiedSkills.includes(id)));
  const ruleIds = union(target.rules, extraRuleIds.filter((id) => target.unverifiedRules.includes(id)));
  const report = {
    agent,
    scope,
    removedSkills: [],
    keptSkills: [],
    removedRules: [],
    keptRules: [],
    mcp: { removed: [], file: store.mcp?.file ?? null },
    removedDirs: [],
    removedState: [],
  };

  if (skills) {
    const claimable =
      store.skills.sharedWith.length > 0
        ? withoutSharerClaims(skillIds, {
            scope,
            sharers: store.skills.sharedWith,
            kind: 'skills',
            cwd,
          })
        : skillIds;
    report.keptSkills = skillIds.filter((id) => !claimable.includes(id));
    report.removedSkills = removeSkillDirs(store.skills.dir, claimable);
    report.removedDirs.push(...pruneEmptyDirs(store.skills.dir, scopeRoot(scope, cwd)));
  }

  if (rules) {
    if (store.rules.kind === 'files') {
      report.removedRules = removeRuleFiles(store.rules.dir, ruleIds, store.rules.ext);
      report.removedDirs.push(...pruneEmptyDirs(store.rules.dir, scopeRoot(scope, cwd)));
    } else {
      const claimable =
        store.rules.sharedWith.length > 0
          ? withoutSharerClaims(ruleIds, {
              scope,
              sharers: projectMarkerRuleSharers(agent, cwd),
              kind: 'rules',
              cwd,
            })
          : ruleIds;
      report.keptRules = ruleIds.filter((id) => !claimable.includes(id));
      report.removedRules = removeRuleMarkers(store.rules.file, claimable);
    }

    // Antigravity project installs ALSO put a bootstrap loader marker (and, before the
    // file-per-rule switch, the rules themselves) into the shared <cwd>/AGENTS.md.
    if (store.rules.legacyMarkersFile) {
      const legacyIds = listWeeglooRuleMarkers(store.rules.legacyMarkersFile);
      // Same authority rule as everywhere else: only ids we are removing anyway, never every
      // marker the shared file happens to hold (those may be codex's or Android Studio's).
      const mine = legacyIds.filter((id) => id !== RULE_LOADING_ID && ruleIds.includes(id));
      const claimable = withoutSharerClaims(mine, {
        scope,
        sharers: projectMarkerRuleSharers(agent, cwd),
        kind: 'rules',
        cwd,
      });
      // The loader marker is antigravity's alone — no other agent reads or claims it.
      const alsoRemoved = removeRuleMarkers(store.rules.legacyMarkersFile, [
        ...claimable,
        ...(legacyIds.includes(RULE_LOADING_ID) ? [RULE_LOADING_ID] : []),
      ]);
      report.removedRules = union(report.removedRules, alsoRemoved.filter((id) => id !== RULE_LOADING_ID));
      report.keptRules = union(report.keptRules, mine.filter((id) => !claimable.includes(id)));
    }
  }

  if (mcp && store.mcp) {
    report.mcp = removeMcpServers(store.mcp);
  }

  if (skills && rules) {
    report.removedState = removeTrackingState(scope, agent, cwd);
  } else if (target.hasRecord) {
    writeInstalledRecord(target.recordPath, {
      ...(skills ? { skills: [], availableSkills: [] } : {}),
      ...(rules ? { rules: [], availableRules: [] } : {}),
    });
  }

  return report;
}

/** Stable key for a detected target (agent + scope), used by the picker and the opt-in map. */
function targetKey(target) {
  return `${target.agent}:${target.scope}`;
}

/** A readable id list — a full 26-skill dump drowns the rest of the report. */
function summarizeIds(ids, limit = 5) {
  return ids.length <= limit
    ? ids.join(', ')
    : `${ids.slice(0, limit).join(', ')} +${ids.length - limit} more`;
}

/** One-line summary of what a detected install holds. */
function describeTarget(target) {
  const bits = [`${target.skills.length} skill(s)`, `${target.rules.length} rule(s)`];
  if (target.mcpServers.length > 0) bits.push(`MCP (${target.mcpServers.join(', ')})`);
  if (target.hasRecord || target.hasStamp) bits.push('tracking state');
  const unverified = target.unverifiedSkills.length + target.unverifiedRules.length;
  if (unverified > 0) bits.push(`${unverified} unverified`);
  return bits.join(', ');
}

/** Wraps a long id list into indented lines so a plan stays readable at any count. */
function idLines(ids, indent, width = 92) {
  const lines = [];
  let current = '';
  for (const id of ids) {
    const next = current ? `${current}, ${id}` : id;
    if (next.length + indent.length > width && current) {
      lines.push(indent + current);
      current = id;
    } else {
      current = next;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

/**
 * The plan shown before anything is deleted. It NAMES every item, because a bare count is
 * unrecognizable: a plan reading "skills … (1)" is what let a user's own `weegloo-npm-publish`
 * skill be deleted with their approval. The store path is on its own line so it cannot be
 * misread as "this whole directory will be removed" — only the listed items are.
 */
function planLines(target, { mcp, skills, rules }) {
  const lines = [];
  if (skills && target.skills.length > 0) {
    lines.push(`      skills  ${chalk.dim(`in ${target.store.skills.dir}`)}`);
    lines.push(...idLines(target.skills, '              '));
  }
  if (rules && target.rules.length > 0) {
    const where =
      target.store.rules.kind === 'files' ? target.store.rules.dir : target.store.rules.file;
    lines.push(`      rules   ${chalk.dim(`in ${where}`)}`);
    lines.push(...idLines(target.rules, '              '));
  }
  if (mcp && target.mcpServers.length > 0) {
    lines.push(`      mcp     ${chalk.dim(target.store.mcp.file)}`);
    lines.push(`              ${target.mcpServers.join(', ')} ${chalk.dim('(entries only — the file is kept)')}`);
  }
  if (skills && rules && (target.hasRecord || target.hasStamp)) {
    lines.push(`      state   ${chalk.dim(path.dirname(target.recordPath))}`);
  }
  return lines;
}

/**
 * Runs the uninstall. Interactive by default — the target list is derived, but choosing WHICH
 * detected installs to remove, and confirming the deletion, stays with the user. `-y` (or a
 * non-TTY) removes exactly the pinned `--agent` at `--location` (default global) with no prompt.
 *
 * @param {object} config  resolved CLI config (uninstall mode)
 * @param {{ promptCheckbox?: typeof checkbox, promptConfirm?: typeof confirm, log?: (s:string)=>void, cwd?: string }} [deps]
 * @returns {Promise<{ ok: boolean, status: string, reports?: object[] }>}
 */
export async function runUninstall(config, deps = {}) {
  const {
    promptCheckbox = checkbox,
    promptConfirm = confirm,
    log = console.log,
    cwd = process.cwd(),
  } = deps;

  const kinds = {
    mcp: config.uninstallMcp !== false,
    skills: config.uninstallSkills !== false,
    rules: config.uninstallRules !== false,
  };

  log(chalk.bold('  ▶  Uninstalling weegloo...'));
  log('');

  const found = detectInstalls({ agent: config.agent, scope: config.scope, cwd });

  if (found.length === 0) {
    log(chalk.yellow('  ⚠  ') + 'No weegloo install found here.');
    log(chalk.dim(`     Scanned this project (${cwd}) and your home directory.`));
    log(chalk.dim('     An install made inside another project folder must be uninstalled from that folder.'));
    log('');
    return { ok: true, status: 'nothing-installed' };
  }

  // Per-target opt-ins for unverified ids (interactive only) — empty means "record only".
  const extras = new Map();

  let targets;
  if (config.nonInteractive) {
    const scope = config.agent === 'androidstudio' ? 'project' : config.scope || 'global';
    targets = found.filter((t) => t.scope === scope);
    if (targets.length === 0) {
      log(chalk.yellow('  ⚠  ') + `No weegloo install found for ${config.agent} at ${scope} scope.`);
      for (const other of found) {
        log(chalk.dim(`     Found one at ${other.scope} scope — re-run with --location ${other.scope}.`));
      }
      log('');
      return { ok: true, status: 'nothing-installed' };
    }
  } else {
    log(chalk.bold('  Found:'));
    for (const target of found) {
      log(
        `   • ${chalk.bold(`${target.agent} (${target.scope})`)}  ${chalk.dim(describeTarget(target))}` +
        (target.strong ? '' : chalk.dim('  — only files shared with another agent/IDE'))
      );
    }
    log('');

    const chosenKeys = await promptCheckbox({
      message: 'Select the installs to remove:',
      choices: found.map((target) => ({
        name: `${target.agent} (${target.scope})  ${chalk.dim(describeTarget(target))}`,
        value: targetKey(target),
        checked: target.strong,
      })),
    });
    targets = found.filter((t) => chosenKeys.includes(targetKey(t)));
    if (targets.length === 0) {
      log(chalk.yellow('  Nothing selected — nothing was changed.'));
      log('');
      return { ok: true, status: 'cancelled' };
    }

    log('');
    log(chalk.bold('  This will delete:'));
    for (const target of targets) {
      log(`   ${chalk.bold(`${target.agent} (${target.scope})`)}`);
      const lines = planLines(target, kinds);
      if (lines.length === 0) log(chalk.dim('      (nothing — already clean)'));
      else for (const line of lines) log(line);
    }
    log('');

    const proceed = await promptConfirm({
      message: `Remove ${targets.length} weegloo install(s)?`,
      default: false,
    });
    if (!proceed) {
      log('');
      log(chalk.yellow('  Uninstall cancelled — nothing was changed.'));
      log('');
      return { ok: true, status: 'cancelled' };
    }
    log('');

    // Unverified items: `weegloo-*` names the install record does not claim. They are offered
    // ONE BY ONE, unchecked, and only after the main confirm — a user's own `weegloo-…` file
    // living in the agent's skills dir is indistinguishable from ours by name alone.
    for (const target of targets) {
      const offer = [
        ...(kinds.skills ? target.unverifiedSkills.map((id) => ({ id, kind: 'skill' })) : []),
        ...(kinds.rules ? target.unverifiedRules.map((id) => ({ id, kind: 'rule' })) : []),
      ];
      if (offer.length === 0) continue;
      log(
        chalk.yellow('  ⚠  ') +
        `${target.agent} (${target.scope}): ${offer.length} item(s) look like weegloo's but are NOT in its install record.`
      );
      log(chalk.dim('     They may be your own files. Nothing here is removed unless you pick it.'));
      const picked = await promptCheckbox({
        message: `Also remove these from ${target.agent} (${target.scope})?`,
        choices: offer.map((o) => ({
          name: `${o.id}  ${chalk.dim(`(${o.kind}, not in the record)`)}`,
          value: `${o.kind}:${o.id}`,
          checked: false,
        })),
      });
      extras.set(targetKey(target), {
        extraSkillIds: picked.filter((v) => v.startsWith('skill:')).map((v) => v.slice(6)),
        extraRuleIds: picked.filter((v) => v.startsWith('rule:')).map((v) => v.slice(5)),
      });
      log('');
    }
  }

  if (config.nonInteractive) {
    // Non-interactive has nobody to ask, so unverified items are never touched — say so by name
    // rather than leaving the user to wonder what was skipped.
    for (const target of targets) {
      const skipped = [
        ...(kinds.skills ? target.unverifiedSkills : []),
        ...(kinds.rules ? target.unverifiedRules : []),
      ];
      if (skipped.length === 0) continue;
      log(
        chalk.yellow('  ⚠  ') +
        `${target.agent} (${target.scope}): left alone (not in the install record) — ${summarizeIds(skipped)}`
      );
      log(chalk.dim('     Run without -y to review and remove them individually.'));
      log('');
    }
  }

  // Sequential on purpose: each target drops its own record before the next runs, so when the
  // user removes BOTH sharers of a store the last one standing finally frees the shared files.
  const reports = [];
  for (const target of targets) {
    const report = uninstallTarget(target, { ...kinds, ...(extras.get(targetKey(target)) ?? {}), cwd });
    reports.push(report);

    log(chalk.bold(`  ✔  ${target.agent} (${target.scope})`));
    const say = (label, value) => log(`     ${label} ${value}`);
    if (!kinds.skills) say('- Skills:', chalk.dim('kept (--ignore-skill)'));
    else say('✔ Skills:', `${report.removedSkills.length} removed`);
    if (!kinds.rules) say('- Rules: ', chalk.dim('kept (--ignore-rule)'));
    else say('✔ Rules: ', `${report.removedRules.length} removed`);
    if (!kinds.mcp) say('- MCP:   ', chalk.dim('kept (--no-mcp)'));
    else if (report.mcp.removed.length > 0) {
      say('✔ MCP:   ', `${report.mcp.removed.join(', ')} removed from ${report.mcp.file}`);
    } else say('- MCP:   ', chalk.dim('no weegloo entries found'));

    const kept = [...report.keptSkills, ...report.keptRules];
    if (kept.length > 0) {
      log(
        chalk.dim(
          `     - Left in shared files (another agent still uses them): ${summarizeIds(kept)}`
        )
      );
    }
    for (const dir of report.removedDirs) log(chalk.dim(`     - Deleted empty dir   ${dir}`));
    for (const entry of report.removedState) log(chalk.dim(`     - Cleared tracking    ${entry}`));
    log('');
  }

  log(chalk.bold.green('  ✔  Uninstall complete!'));
  log('');
  if (reports.some((r) => r.mcp.removed.length > 0)) {
    // A staging / enterprise install recorded its origins mapping — point at ITS console.
    const origins = targets.find((t) => t.origins)?.origins ?? null;
    log(chalk.dim('  The Personal Access Token was removed from the MCP config, but the token'));
    log(chalk.dim('  itself is still valid. Revoke it if you no longer need it:'));
    log('     ' + chalk.cyan(applyOriginMapping(PAT_PAGE_URL, origins)));
    log('');
  }
  const notes = [];
  if (targets.some((t) => t.agent === 'claude')) {
    notes.push(
      'Claude Code: if you also added the marketplace plugin, remove it with ' +
      '`claude plugin uninstall weegloo@weegloo-plugins`.'
    );
  }
  if (targets.some((t) => t.agent === 'codex')) {
    notes.push(
      `Codex: the project trust entry in ${getCodexConfigPath('global')} was left as-is (it is ` +
      'your setting, not weegloo\'s), and Codex may still hold an MCP login for weegloo.'
    );
  }
  if (notes.length > 0) {
    log(chalk.bold('  Left for you to decide:'));
    for (const note of notes) log(chalk.dim(`   • ${note}`));
    log('');
  }

  return { ok: true, status: 'uninstalled', reports };
}
