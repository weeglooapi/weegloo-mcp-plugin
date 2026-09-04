/**
 * WHERE each agent keeps its weegloo artifacts — skills, rules, and MCP config — per scope,
 * and which of those stores are physically SHARED with another agent. One map, because three
 * flows need the same answer: `--update` (what to rewrite), `--uninstall` (what to remove), and
 * the install-time reconcile (what to prune). Keeping it here is what lets those flows stay free
 * of filesystem-layout knowledge.
 *
 * Sharing is a fact of the layout, not a choice made here:
 *   - codex + antigravity (project) share the skills dir `.agents/skills`;
 *   - codex + antigravity + androidstudio (project) share rule markers in `<cwd>/AGENTS.md`
 *     (markers carry no agent namespace);
 *   - androidstudio's MCP config is Android Studio's own config dir — one file for the whole
 *     IDE, not per project.
 * Global scope shares nothing (every path diverges per agent). `sharedWith` lists the OTHER
 * agents whose diverging branch would make writing that store a cross-agent overwrite.
 */
import os from 'node:os';
import path from 'node:path';

import { getClaudeSkillsDir, getClaudeRulesDir, getClaudeMcpPath } from './claude.js';
import { getCursorSkillsDir, getCursorRulesDir, getCursorMcpPath } from './cursor.js';
import { getCodexSkillsDir, getCodexInstructionsPath, getCodexConfigPath } from './codex.js';
import {
  getAntigravitySkillsDir,
  getAntigravityRulesFile,
  getAntigravityRulesDir,
  getAntigravityMcpPath,
  toAntigravityRuleContent,
} from './antigravity.js';
import { resolveAndroidStudioConfigDir } from './androidstudio.js';

/** Server names this installer writes into an agent's MCP config (and removes on uninstall). */
export const MCP_SERVER_NAMES = ['weegloo', 'weegloo-upload'];

/** Agents that only ever install project-scoped (index.js normalizes their scope too). */
const PROJECT_ONLY_AGENTS = new Set(['androidstudio']);

/** The scopes an agent can actually be installed at. */
export function agentScopes(agent) {
  return PROJECT_ONLY_AGENTS.has(agent) ? ['project'] : ['global', 'project'];
}

/**
 * The root a scope's artifacts live under — used to bound empty-directory cleanup so pruning
 * can never walk above the install root.
 */
export function scopeRoot(scope, cwd = process.cwd()) {
  return scope === 'project' ? cwd : os.homedir();
}

/**
 * The agent's MCP config descriptor: `kind` says how the weegloo entries are embedded, which
 * decides how they come out again. `json` keeps them as named keys under `container`; `codex`
 * uses TOML tables (`[mcp_servers.weegloo…]`), stripped by codex.js `stripWeeglooMcpSections`.
 */
function getMcpStore(agent, scope) {
  switch (agent) {
    case 'claude':
      return { kind: 'json', file: getClaudeMcpPath(scope), container: 'mcpServers' };
    case 'cursor':
      return { kind: 'json', file: getCursorMcpPath(scope), container: 'mcpServers' };
    case 'antigravity':
      return { kind: 'json', file: getAntigravityMcpPath(scope), container: 'mcpServers' };
    case 'androidstudio':
      // Android Studio reads ONE mcp.json from its own (version-stamped) config directory —
      // not from the project — so this file is shared by every project on the machine.
      return {
        kind: 'json',
        file: path.join(resolveAndroidStudioConfigDir().dir, 'mcp.json'),
        container: 'mcpServers',
        ideWide: true,
      };
    case 'codex':
      return { kind: 'toml', file: getCodexConfigPath(scope) };
    default:
      return null;
  }
}

/**
 * The full store layout for one agent+scope, or null for an unknown agent.
 *
 * @param {string} agent
 * @param {'global'|'project'} scope
 * @returns {{
 *   skills: { dir: string, sharedWith: string[] },
 *   rules: { kind: 'files'|'markers', dir?: string, ext?: string, file?: string,
 *            sharedWith: string[], legacyMarkersFile?: string, transform?: (s:string)=>string },
 *   mcp: { kind: 'json'|'toml', file: string, container?: string, ideWide?: boolean },
 * } | null}
 */
export function getAgentStore(agent, scope) {
  const mcp = getMcpStore(agent, scope);
  switch (agent) {
    case 'claude':
      return {
        skills: { dir: getClaudeSkillsDir(scope), sharedWith: [] },
        rules: { kind: 'files', dir: getClaudeRulesDir(scope), ext: 'md', sharedWith: [] },
        mcp,
      };
    case 'cursor':
      return {
        skills: { dir: getCursorSkillsDir(scope), sharedWith: [] },
        rules: { kind: 'files', dir: getCursorRulesDir(scope), ext: 'mdc', sharedWith: [] },
        mcp,
      };
    case 'codex':
      return {
        skills: { dir: getCodexSkillsDir(scope), sharedWith: scope === 'project' ? ['antigravity'] : [] },
        rules: {
          kind: 'markers',
          file: getCodexInstructionsPath(scope),
          sharedWith: scope === 'project' ? ['antigravity', 'androidstudio'] : [],
        },
        mcp,
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
            mcp,
          }
        : {
            skills: { dir: getAntigravitySkillsDir(scope), sharedWith: [] },
            rules: { kind: 'markers', file: getAntigravityRulesFile(scope), sharedWith: [] },
            mcp,
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
        mcp,
      };
    default:
      return null;
  }
}
