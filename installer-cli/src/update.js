/**
 * The `--update` flow: refresh ONE agent's installed weegloo skills/rules to its branch's
 * newest version while PRESERVING the user's selection. This is what the weegloo-version rule's
 * baked command runs. It differs from an install on purpose:
 *
 *  - the SELECTION AUTHORITY is the per-agent installed.json (that is what the record is for);
 *    the only sanctioned deselection channel is the installer's checkbox, so a hand-deleted
 *    skill/rule is treated as drift and RESTORED, exactly like corrupted file content. Disk is
 *    the fallback only when no per-agent record exists yet (a pre-migration install) — and the
 *    legacy flat record is never a selection source, because it mixes other agents' picks;
 *  - it is never re-asked and never defaults to "all" — the full-reinstall-on-update bug this
 *    flow replaces;
 *  - genuinely NEW upstream items are auto-added: new = catalog \ prevAvailable, where
 *    prevAvailable is the catalog snapshot the record kept from the last install/update. An item
 *    absent from BOTH the selection and prevAvailable was never offered before (add it); present
 *    in prevAvailable but not selected means the user deselected it (respect that);
 *  - upstream-deleted items are pruned via the record diff in syncInstalledRecord;
 *  - core rules are always (re)added — the update notifier and the terms gate must survive;
 *  - MCP config is never touched (remote server is always current), so no token is needed;
 *  - it is idempotent: re-running against an unchanged branch just repairs drift.
 *
 * Never falls back to installing: a scope/agent with no weegloo artifacts is a no-op with a
 * pointer to the install command.
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { select } from '@inquirer/prompts';

import { REPO, loadResources } from './github.js';
import {
  CORE_RULE_IDS,
  applySelfUpdateTemplate,
  getVersionStampPath,
  getInstalledRecordPath,
  getLegacyInstalledRecordPath,
  readInstalledRecord,
  syncInstalledRecord,
} from './self-update.js';
import {
  SAFE_ID,
  writeContentFile,
  removeSkillDirs,
  removeRuleFiles,
  listWeeglooSkillDirs,
  listWeeglooRuleFiles,
  listWeeglooRuleMarkers,
} from './io.js';
import { getClaudeSkillsDir, getClaudeRulesDir } from './claude.js';
import { getCursorSkillsDir, getCursorRulesDir } from './cursor.js';
import {
  getCodexSkillsDir,
  getCodexInstructionsPath,
  upsertRuleInAgentsMd,
  removeRuleMarkers,
} from './codex.js';
import {
  getAntigravitySkillsDir,
  getAntigravityRulesFile,
  getAntigravityRulesDir,
  maintainAntigravityProjectRulesFile,
  toAntigravityRuleContent,
  RULE_LOADING_ID,
} from './antigravity.js';

/**
 * Where each agent keeps its weegloo artifacts, plus which stores are SHARED with other agents
 * in project scope. Sharing is a physical fact of the layout, not a choice here:
 *   - codex + antigravity (project) share the skills dir `.agents/skills`;
 *   - codex + antigravity + androidstudio (project) share rule markers in `<cwd>/AGENTS.md`
 *     (markers carry no agent namespace).
 * Global scope shares nothing (every path diverges per agent). `sharedWith` lists the OTHER
 * agents whose diverging branch would make writing that store a cross-agent overwrite.
 */
function getAgentStore(agent, scope) {
  switch (agent) {
    case 'claude':
      return {
        skills: { dir: getClaudeSkillsDir(scope), sharedWith: [] },
        rules: { kind: 'files', dir: getClaudeRulesDir(scope), ext: 'md', sharedWith: [] },
      };
    case 'cursor':
      return {
        skills: { dir: getCursorSkillsDir(scope), sharedWith: [] },
        rules: { kind: 'files', dir: getCursorRulesDir(scope), ext: 'mdc', sharedWith: [] },
      };
    case 'codex':
      return {
        skills: { dir: getCodexSkillsDir(scope), sharedWith: scope === 'project' ? ['antigravity'] : [] },
        rules: {
          kind: 'markers',
          file: getCodexInstructionsPath(scope),
          sharedWith: scope === 'project' ? ['antigravity', 'androidstudio'] : [],
        },
      };
    case 'antigravity':
      // Project rules are file-per-rule in .agents/rules (out of the shared AGENTS.md marker
      // store) — AGENTS.md keeps only the agent-agnostic bootstrap loader, which the other
      // marker agents never touch, so rules carry no sharedWith anymore. `legacyMarkersFile`
      // lets detection still see a pre-migration install whose rules exist only as markers.
      // Global stays markers in the antigravity-private GEMINI.md.
      return scope === 'project'
        ? {
            skills: { dir: getAntigravitySkillsDir(scope), sharedWith: ['codex'] },
            rules: {
              kind: 'files',
              dir: getAntigravityRulesDir(),
              ext: 'md',
              sharedWith: [],
              legacyMarkersFile: getAntigravityRulesFile('project'),
              // Antigravity parses rule-file frontmatter for a `trigger` — inject always_on.
              transform: toAntigravityRuleContent,
            },
          }
        : {
            skills: { dir: getAntigravitySkillsDir(scope), sharedWith: [] },
            rules: { kind: 'markers', file: getAntigravityRulesFile(scope), sharedWith: [] },
          };
    case 'androidstudio':
      // Project-only agent; its skills dir is private but its rules share <cwd>/AGENTS.md.
      return {
        skills: { dir: path.join(process.cwd(), '.android-studio', 'skills'), sharedWith: [] },
        rules: {
          kind: 'markers',
          file: path.join(process.cwd(), 'AGENTS.md'),
          sharedWith: ['codex', 'antigravity'],
        },
      };
    default:
      return null;
  }
}

/** Reads a small JSON file, or {} when absent/corrupt (same tolerance as the rule's reader). */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Pure set arithmetic of an update — separated for direct testing. All outputs preserve
 * CATALOG order (stable, matches what an install would produce).
 *
 * `selected*Ids` is the user's selection — the per-agent record when it exists, else the disk
 * scan (pre-migration fallback). In the fallback case it may contain ids that are not
 * weegloo's (a user-authored `weegloo-foo`); intersecting with the catalog here is what
 * guarantees such files are never written over (and syncInstalledRecord's record diff is what
 * guarantees they are never deleted). An empty `prevAvailable*` means the offering back then
 * is unknown (a legacy record) → no auto-add this cycle; the catalog snapshot written
 * afterwards makes the NEXT cycle precise.
 *
 * @returns {{ addSkillIds: string[], newSkillIds: string[], addRuleIds: string[], newRuleIds: string[] }}
 */
export function planUpdate({
  catalogSkillIds,
  catalogRuleIds,
  selectedSkillIds,
  selectedRuleIds,
  prevAvailableSkills,
  prevAvailableRules,
}) {
  const pick = (catalog, selected, prevAvailable, forcedIds = []) => {
    const selectedSet = new Set(selected);
    const prevSet = new Set(prevAvailable);
    const forced = new Set(forcedIds);
    const newIds = prevAvailable.length > 0 ? catalog.filter((id) => !prevSet.has(id)) : [];
    const newSet = new Set(newIds);
    const add = catalog.filter((id) => selectedSet.has(id) || newSet.has(id) || forced.has(id));
    return { add, newIds };
  };

  const skills = pick(catalogSkillIds, selectedSkillIds, prevAvailableSkills);
  const rules = pick(catalogRuleIds, selectedRuleIds, prevAvailableRules, CORE_RULE_IDS);
  return {
    addSkillIds: skills.add,
    newSkillIds: skills.newIds,
    addRuleIds: rules.add,
    newRuleIds: rules.newIds,
  };
}

/**
 * Refs of the OTHER agents that share a store with `agent` in this scope, read from their
 * per-agent stamps. A sharer that predates per-agent tracking is invisible here (its artifacts
 * live in the very stores it shares, so nothing on disk attributes to it) — that limitation is
 * accepted: last-writer-wins is also what installs have always done.
 *
 * @returns {Array<{ agent: string, ref: string|null }>}
 */
function detectSharerRefs(agent, scope, sharedWith) {
  const sharers = [];
  for (const other of sharedWith) {
    const stamp = readJsonSafe(getVersionStampPath(scope, other));
    const record = getInstalledRecordPath(scope, other);
    if (Object.keys(stamp).length > 0 || fs.existsSync(record)) {
      sharers.push({ agent: other, ref: typeof stamp.ref === 'string' ? stamp.ref : null });
    }
  }
  return sharers;
}

/** Writes one skill: clean-sync (drop the old dir first so upstream-removed files don't linger). */
function writeSkill(skillsDir, skill) {
  if (!SAFE_ID.test(skill.id)) return;
  const destDir = path.join(skillsDir, skill.id);
  fs.rmSync(destDir, { recursive: true, force: true });
  for (const [fileName, content] of Object.entries(skill.files)) {
    writeContentFile(path.join(destDir, fileName), content);
  }
}

/**
 * Runs the update for one agent+scope. Interactivity is confined to the ONE genuinely human
 * question (shared-store branch conflict); everything else is derived, which is why the baked
 * command carries no `--yes`.
 *
 * @param {object} config  resolved CLI config (update mode)
 * @param {{ loadResourcesFn?: typeof loadResources, promptSelect?: typeof select, log?: (s:string)=>void }} [deps]
 * @returns {Promise<{ ok: boolean, status: string }>}
 */
export async function runUpdate(config, deps = {}) {
  const { loadResourcesFn = loadResources, promptSelect = select, log = console.log } = deps;

  const agent = config.agent;
  const scope = agent === 'androidstudio' ? 'project' : config.scope || 'global';
  const store = getAgentStore(agent, scope);

  log(chalk.bold(`  ▶  Updating weegloo for ${agent} (${scope})...`));
  log('');

  // ── Disk detection (prefix scan — deliberately catalog-free, see io.js) ────────────────────
  // Disk is the selection FALLBACK for pre-migration installs, and the drift signal for the
  // "restored" report; the selection authority is the per-agent record below.
  const diskSkillIds = listWeeglooSkillDirs(store.skills.dir);
  let diskRuleIds =
    store.rules.kind === 'files'
      ? listWeeglooRuleFiles(store.rules.dir, store.rules.ext)
      : listWeeglooRuleMarkers(store.rules.file);
  if (store.rules.legacyMarkersFile) {
    // A pre-migration install's rules exist only as markers in the old shared context file —
    // union them in (minus the bootstrap loader) so detection and the no-record selection
    // fallback still see that install. Catalog intersection keeps foreign markers inert.
    const legacy = listWeeglooRuleMarkers(store.rules.legacyMarkersFile).filter(
      (id) => id !== RULE_LOADING_ID
    );
    diskRuleIds = [...new Set([...diskRuleIds, ...legacy])];
  }

  // ── Selection: the per-agent record is the authority; disk only when it doesn't exist ──────
  // The record is exactly the metadata we keep for this purpose — a hand-deleted skill is drift
  // to repair (like corrupted content), NOT a deselection; deselecting happens in the install
  // checkbox. The legacy flat record is never a selection source: it is shared by all agents
  // (last-writer-wins), so it may carry OTHER agents' picks — it only feeds the prune diff.
  const recordPath = getInstalledRecordPath(scope, agent);
  const legacyRecordPath = getLegacyInstalledRecordPath(scope);
  const hasOwnRecord = fs.existsSync(recordPath);
  const prev = hasOwnRecord ? readInstalledRecord(recordPath) : readInstalledRecord(legacyRecordPath);
  const selectedSkillIds = hasOwnRecord ? prev.skills : diskSkillIds;
  const selectedRuleIds = hasOwnRecord ? prev.rules : diskRuleIds;

  // Which kinds this run manages: the flag opt-outs, and "was this kind ever selected here" —
  // a rules-less install (--ignore-rule) must stay rules-less, core rules included.
  const manageSkills = !config.ignoreSkill && selectedSkillIds.length > 0;
  let manageRules = !config.ignoreRule && selectedRuleIds.length > 0;

  if (!manageSkills && !manageRules) {
    // Nothing installed here. Updating is "refresh what exists" — installing is a different,
    // deliberate act (and silently installing everything is the exact bug --update replaces).
    log(chalk.yellow('  ⚠  ') + `No weegloo skills/rules found for ${agent} at ${scope} scope.`);
    log(chalk.dim(`     Nothing to update. To install: npx weegloo@latest --agent ${agent} --location ${scope}`));
    log('');
    return { ok: true, status: 'nothing-installed' };
  }

  // ── Resolve the branch: pinned flag > this agent's stamp > latest ───────────────────────────
  const stampPath = getVersionStampPath(scope, agent);
  const stamp = readJsonSafe(stampPath);
  const ref = config.pluginRef || (typeof stamp.ref === 'string' ? stamp.ref : null) || 'latest';

  const spinner = ora({ text: `  Fetching manifest  ${chalk.dim(`${REPO} @ ${ref}`)}`, indent: 0 }).start();
  const resources = await loadResourcesFn(ref);
  if (!resources) {
    spinner.fail(`  Could not load the manifest for branch '${ref}'.`);
    log(chalk.dim('     Nothing was changed. Check your network connection (or the branch name) and retry.'));
    log('');
    return { ok: false, status: 'manifest-unavailable' };
  }
  spinner.succeed(`  Manifest loaded  ${chalk.dim(`${REPO} @ ${ref}${resources.version ? ` (version ${resources.version})` : ''}`)}`);

  const catalogSkillIds = resources.skills.map((s) => s.id);
  const catalogRuleIds = resources.rules.map((r) => r.id);

  const plan = planUpdate({
    catalogSkillIds,
    catalogRuleIds,
    selectedSkillIds,
    selectedRuleIds,
    prevAvailableSkills: prev.availableSkills,
    prevAvailableRules: prev.availableRules,
  });

  // Drift report: selected-but-missing-from-disk items that this run brings back (new items
  // are reported separately). Purely informational — the write path below is the same.
  const diskSkillSet = new Set(diskSkillIds);
  const diskRuleSet = new Set(diskRuleIds);
  const newSkillSet = new Set(plan.newSkillIds);
  const newRuleSet = new Set(plan.newRuleIds);
  const restoredSkills = plan.addSkillIds.filter((id) => !diskSkillSet.has(id) && !newSkillSet.has(id));
  const restoredRules = plan.addRuleIds.filter((id) => !diskRuleSet.has(id) && !newRuleSet.has(id));

  // ── Shared-store branch conflict (project-scope marker/dir sharing) ─────────────────────────
  // The stores are physically shared, so whoever writes last wins — the only real question is
  // whether the user meant to stamp THIS branch's content over a sharer on a different branch.
  // Only stores this run actually WRITES count: an unmanaged kind's sharing is irrelevant.
  const sharedWith = [
    ...new Set([
      ...(manageSkills ? store.skills.sharedWith : []),
      ...(manageRules ? store.rules.sharedWith : []),
    ]),
  ];
  let skipSharedStores = false;
  if (sharedWith.length > 0) {
    const sharers = detectSharerRefs(agent, scope, sharedWith);
    const conflicting = sharers.filter((s) => s.ref == null || s.ref !== ref);
    if (conflicting.length > 0) {
      const names = conflicting.map((s) => `${s.agent}(${s.ref ?? 'unknown branch'})`).join(', ');
      if (config.nonInteractive) {
        log(chalk.yellow('  ⚠  ') + `Shared files are also used by ${names}; overwriting with '${ref}' content (last write wins).`);
        log(chalk.dim('     Consider keeping all agents in this project on the same branch.'));
      } else {
        const choice = await promptSelect({
          message: `This project's shared weegloo files are also used by ${names}. Update them with '${ref}' content?`,
          choices: [
            { name: `Overwrite with '${ref}' (last write wins)`, value: 'overwrite' },
            { name: 'Skip the shared files, update the rest', value: 'skip' },
            { name: 'Abort', value: 'abort' },
          ],
        });
        if (choice === 'abort') {
          log(chalk.dim('  Aborted — nothing was changed.'));
          log('');
          return { ok: true, status: 'aborted' };
        }
        skipSharedStores = choice === 'skip';
      }
    }
  }
  const skipSkills = skipSharedStores && store.skills.sharedWith.length > 0;
  const skipRules = skipSharedStores && store.rules.sharedWith.length > 0;
  const effectiveManageSkills = manageSkills && !skipSkills;
  const effectiveManageRules = manageRules && !skipRules;
  if ((manageSkills && skipSkills) || (manageRules && skipRules)) {
    log(chalk.dim('  - Shared files left untouched (their tracking is preserved too).'));
  }
  if (!effectiveManageSkills && !effectiveManageRules) {
    log(chalk.yellow('  ⚠  ') + 'Every store this agent uses here is shared and was skipped — nothing to update.');
    log('');
    return { ok: true, status: 'all-shared-skipped' };
  }

  // ── Write the add-set (selection kept + genuinely new + core rules) ─────────────────────────
  if (effectiveManageSkills) {
    const byId = new Map(resources.skills.map((s) => [s.id, s]));
    for (const id of plan.addSkillIds) writeSkill(store.skills.dir, byId.get(id));
  }
  if (effectiveManageRules) {
    const templated = applySelfUpdateTemplate(resources.rules, { agent, ref, scope });
    const byId = new Map(templated.map((r) => [r.id, r]));
    for (const id of plan.addRuleIds) {
      const rule = byId.get(id);
      const content = store.rules.transform ? store.rules.transform(rule.content) : rule.content;
      if (store.rules.kind === 'files') {
        writeContentFile(path.join(store.rules.dir, `${rule.id}.${store.rules.ext}`), content);
      } else {
        upsertRuleInAgentsMd(store.rules.file, rule.id, content);
      }
    }
    if (agent === 'antigravity' && scope === 'project') {
      // Keep the AGENTS.md bootstrap loader in place and (when no other marker agent is
      // around) migrate legacy full-rule markers out — stale markers would outrank the fresh
      // .agents/rules files in Antigravity's precedence.
      const cleaned = maintainAntigravityProjectRulesFile();
      if (cleaned.length > 0) {
        log(chalk.dim(`  - Migrated ${cleaned.length} legacy rule marker(s) out of AGENTS.md`));
      }
    }
  }

  // ── Prune upstream-deleted / stale entries + persist record & stamp ─────────────────────────
  const { removedSkills, removedRules } = syncInstalledRecord({
    scope,
    agent,
    stampPath,
    recordPath,
    legacyRecordPath,
    version: resources.version,
    ref,
    manageSkills: effectiveManageSkills,
    installedSkillIds: plan.addSkillIds,
    availableSkillIds: catalogSkillIds,
    removeSkills: (ids) => removeSkillDirs(store.skills.dir, ids),
    manageRules: effectiveManageRules,
    installedRuleIds: plan.addRuleIds,
    availableRuleIds: catalogRuleIds,
    removeRules: (ids) =>
      store.rules.kind === 'files'
        ? removeRuleFiles(store.rules.dir, ids, store.rules.ext)
        : removeRuleMarkers(store.rules.file, ids),
  });

  // ── Report ──────────────────────────────────────────────────────────────────────────────────
  const line = (kind, add, added, restored, removed, skipped) => {
    if (skipped) return chalk.dim(`  - ${kind}: skipped`);
    const bits = [`${add.length} synced`];
    if (added.length > 0) bits.push(chalk.green(`${added.length} new (${added.join(', ')})`));
    if (restored.length > 0) bits.push(chalk.cyan(`${restored.length} restored (${restored.join(', ')})`));
    if (removed.length > 0) bits.push(chalk.yellow(`${removed.length} removed (${removed.join(', ')})`));
    return `  ✔ ${kind}: ${bits.join(', ')}`;
  };
  log(line('Skills', plan.addSkillIds, effectiveManageSkills ? plan.newSkillIds : [], effectiveManageSkills ? restoredSkills : [], removedSkills, !effectiveManageSkills));
  log(line('Rules', plan.addRuleIds, effectiveManageRules ? plan.newRuleIds : [], effectiveManageRules ? restoredRules : [], removedRules, !effectiveManageRules));
  if (prev.availableSkills.length === 0 && prev.availableRules.length === 0) {
    log(chalk.dim('  - First update with the new tracking: catalog snapshot recorded — newly added items will auto-install from the next update on.'));
  }
  log('');
  log(chalk.bold.green('  ✔  Update complete!') + chalk.dim(`  (MCP config untouched; branch ${ref})`));
  log('');
  return { ok: true, status: 'updated' };
}
