/**
 * CLI flag layer: pure parsing + resolution + conflict validation (no IO / no
 * network / no prompts), so "which answer came from a flag vs. needs a prompt"
 * and "which flag combinations are illegal" live in ONE testable place.
 *
 * index.js consumes the resolved config: a non-null field is pinned by a flag/env
 * (skip the prompt); a null field means "ask in interactive mode, or fall back to
 * the documented default in non-interactive mode".
 */

import { parseArgs } from 'node:util';

/**
 * Selectable IDE/agent targets (the installer internally calls this `ide`).
 */
export const AGENTS = ['cursor', 'claude', 'codex', 'antigravity', 'androidstudio'];
/** Install scopes (maps to `scope`). */
export const LOCATIONS = ['project', 'global'];
/** MCP server groups. `default` is the user-facing alias for the empty group ''. */
export const MCP_GROUPS = ['default', 'core', 'extra', 'all'];
/**
 * GUI hosts that launch an agent with a bare login PATH, so the local `npx`-based
 * `weegloo-upload` server needs an explicit PATH env to be found. Orthogonal to
 * `--agent`: the host says *where* the agent runs, the agent says *what config* we write.
 */
export const HOSTS = ['xcode'];
/** Agents that can run *inside* a GUI host (Xcode Intelligence hosts only these). */
export const HOSTABLE_AGENTS = ['claude', 'codex'];

export const HELP_TEXT = `
  Weegloo MCP Plugin Installer

  Usage:
    npx weegloo [options]

  Run with no options for the interactive installer. Any option below pre-fills
  its choice and skips that prompt; with -y (or in a non-TTY/piped environment)
  the installer runs fully non-interactively, prompting for nothing.

  Options:
    -b, --branch <ref>   Plugin version/branch to install (default: latest)
                         (alias of --ref; also reads WEEGLOO_REF)
    -a, --agent <id>     Target IDE/agent: ${AGENTS.join(' | ')}
        --host <id>      Run the agent inside a GUI host: ${HOSTS.join(' | ')}
                         (only with --agent ${HOSTABLE_AGENTS.join('/')}; injects PATH so the
                         npx-based upload server is found when Xcode spawns it)
    -l, --location <loc> Install location: ${LOCATIONS.join(' | ')} (default: global)
        --mcp <group>    Install the MCP server with group: ${MCP_GROUPS.join(' | ')}
        --no-mcp         Do not install the MCP server
    -t, --token <pat>    Weegloo Personal Access Token (also reads WEEGLOO_TOKEN)
        --ignore-skill   Do not install Skills
        --ignore-rule    Do not install Rules
        --origins <file> Origins mapping (JSON file or inline JSON): rewrite the
                         weegloo origins baked into skills/rules/MCP config for a
                         staging or enterprise stack. Install only — updates
                         reuse the mapping recorded at install time.
        --update         Update an existing install: refresh this agent's installed
                         skills/rules to the branch's newest version, KEEPING the
                         user's selection (auto-adds genuinely new items, prunes
                         upstream-deleted ones). Skills/Rules only — never touches
                         MCP config, so no token is needed. Requires --agent; the
                         branch defaults to the one the agent was installed from.
    -y, --yes            Non-interactive: use defaults for anything not given
    -d, --all-branches   Show all branches in the version picker (interactive only)
    -h, --help           Show this help

  Non-interactive defaults: branch=latest, MCP+Skills+Rules on, group=default,
  location=global, all Skills and Rules selected. --agent is always required,
  and a token (--token / WEEGLOO_TOKEN) is required whenever MCP is installed
  (never for --update).
`;

const OPTIONS = {
  // multiple: collect every --branch/--ref so conflicting values can be detected
  // instead of silently collapsing to the last one.
  branch: { type: 'string', short: 'b', multiple: true },
  ref: { type: 'string', multiple: true },
  agent: { type: 'string', short: 'a' },
  host: { type: 'string' },
  location: { type: 'string', short: 'l' },
  // string (not boolean): the group value is required, and its presence implies install.
  mcp: { type: 'string' },
  // own boolean option — parseArgs has no generic `--no-` negation.
  'no-mcp': { type: 'boolean' },
  token: { type: 'string', short: 't' },
  'ignore-skill': { type: 'boolean' },
  'ignore-rule': { type: 'boolean' },
  origins: { type: 'string' },
  update: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  'all-branches': { type: 'boolean', short: 'd' },
  help: { type: 'boolean', short: 'h' },
};

/**
 * Parses argv into a values object. Throws on unknown flags / missing values /
 * stray positionals (the caller turns that into a friendly error + help hint).
 * This CLI takes no positional arguments, so any positional is a typo (e.g.
 * `weegloo claude` instead of `weegloo --agent claude`) and must not be swallowed.
 * @param {string[]} argv  process.argv.slice(2)
 */
export function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    strict: true,
    allowPositionals: true,
  });
  if (positionals.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(', ')}. This command takes options only (see --help).`
    );
  }
  return values;
}

/** Flattens a possibly-multiple string option to a trimmed, non-empty list. */
function toList(value) {
  const arr = Array.isArray(value) ? value : value != null ? [value] : [];
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * Resolves parsed flags + environment + TTY state into the installer config and
 * the set of hard errors / soft warnings. Pure: no IO.
 *
 * @param {{ values: Record<string, any>, env?: Record<string, string|undefined>, isTTY?: boolean, pkgPluginRef?: string }} input
 * @returns {{ errors: string[], warnings: string[], config: object }}
 */
export function resolveConfig({ values, env = {}, isTTY = true, pkgPluginRef = 'latest' }) {
  const errors = [];
  const warnings = [];

  // Non-interactive when explicitly asked (-y) OR when there is no TTY to prompt on
  // (piped/CI/agent). Both enter the same mode: pinned flags + documented defaults.
  const nonInteractive = !!values.yes || !isTTY;

  // ── branch / ref (merged: --branch is an alias of --ref) ──────────────────
  const refValues = [...toList(values.branch), ...toList(values.ref)];
  const distinctRefs = [...new Set(refValues)];
  if (distinctRefs.length > 1) {
    errors.push(
      `Conflicting branch refs (${distinctRefs.join(', ')}). Provide a single --branch/--ref value.`
    );
  }
  const envRef = (env.WEEGLOO_REF || '').trim();
  const flagRef = distinctRefs[0] || '';
  // Pinned ⇒ the version picker is skipped (matches the prior --ref/WEEGLOO_REF behavior).
  const refPinned = !!flagRef || !!envRef;
  let pluginRef = flagRef || envRef || null;
  // In update mode an unpinned ref must stay null: the update flow resolves it from the
  // agent's own stamp (the branch it was installed from), falling back to latest only when
  // the stamp predates ref tracking. Defaulting to latest here would silently migrate a
  // pinned install's branch.
  if (pluginRef == null && nonInteractive && !values.update) {
    pluginRef = pkgPluginRef || 'latest';
  }

  // ── agent / IDE ───────────────────────────────────────────────────────────
  let agent = null;
  if (values.agent != null) {
    const a = String(values.agent).trim();
    if (a === 'xcode') {
      // Common mistake: Xcode is a host, not an agent. Point at the right flag.
      errors.push(
        `'xcode' is not an --agent; it is a host. Use --host xcode with --agent ${HOSTABLE_AGENTS.join('/')}.`
      );
    } else if (!AGENTS.includes(a)) {
      errors.push(`Invalid --agent '${a}'. Valid values: ${AGENTS.join(', ')}.`);
    } else {
      agent = a;
    }
  }

  // ── host (GUI wrapper; orthogonal to agent) ─────────────────────────────────
  let host = null;
  if (values.host != null) {
    const h = String(values.host).trim();
    if (!HOSTS.includes(h)) {
      errors.push(`Invalid --host '${h}'. Valid values: ${HOSTS.join(', ')}.`);
    } else {
      host = h;
      // A host only makes sense for agents it can actually launch. Validate against a
      // pinned agent; when the agent is unpinned (interactive), the prompt is constrained.
      if (agent != null && !HOSTABLE_AGENTS.includes(agent)) {
        errors.push(
          `--host ${h} only works with --agent ${HOSTABLE_AGENTS.join('/')} (Xcode does not host '${agent}').`
        );
      }
    }
  }

  // ── location / scope ────────────────────────────────────────────────────────
  let scope = null;
  if (values.location != null) {
    const l = String(values.location).trim();
    if (!LOCATIONS.includes(l)) {
      errors.push(`Invalid --location '${l}'. Valid values: ${LOCATIONS.join(', ')}.`);
    } else {
      scope = l;
    }
  }

  // ── MCP toggle + group ──────────────────────────────────────────────────────
  if (values.mcp != null && values['no-mcp']) {
    errors.push('--mcp and --no-mcp cannot be used together.');
  }
  let installMcp = null;
  let mcpGroup = null; // null = not pinned (ask / default ''); '' = default group, explicitly pinned
  if (values['no-mcp']) {
    installMcp = false;
  } else if (values.mcp != null) {
    installMcp = true;
    const g = String(values.mcp).trim();
    if (!MCP_GROUPS.includes(g)) {
      errors.push(`Invalid --mcp group '${g}'. Valid values: ${MCP_GROUPS.join(', ')}.`);
    } else {
      mcpGroup = g === 'default' ? '' : g;
    }
  }

  // ── skills / rules toggles ──────────────────────────────────────────────────
  const ignoreSkill = !!values['ignore-skill'];
  const ignoreRule = !!values['ignore-rule'];
  let installSkillsRules = null;
  if (ignoreSkill && ignoreRule) installSkillsRules = false;
  else if (ignoreSkill || ignoreRule) installSkillsRules = true; // they clearly want the other one

  // ── token (flag > env; trimmed, empty rejected) ─────────────────────────────
  const flagToken = (values.token != null ? String(values.token) : '').trim();
  const envToken = (env.WEEGLOO_TOKEN || '').trim();
  const token = flagToken || envToken || null;

  const showAllBranches = !!values['all-branches'];

  // ── update mode (--update): refresh an existing install's skills/rules ──────
  // Skills/Rules only by design: the remote weegloo MCP is always current and the local
  // upload server is npx-resolved, so there is nothing to reinstall — which is also what
  // makes the command token-free and safe to run unattended.
  // origins mapping input (flag > env). Kept as the RAW string here — file IO/JSON parsing
  // happens in index.js (resolveConfig stays pure); only combination rules are checked here.
  const flagOrigins = (values.origins != null ? String(values.origins) : '').trim();
  const envOrigins = (env.WEEGLOO_ORIGINS || '').trim();
  const origins = flagOrigins || envOrigins || null;

  const update = !!values.update;
  if (update) {
    if (origins != null) {
      // Ignoring would be a FALSE SUCCESS: the user asked for an environment change, and an
      // update cannot deliver it (it never touches MCP config) — unlike a superfluous --token,
      // which is warn-and-ignore because ignoring it still yields exactly what was asked.
      errors.push(
        '--origins cannot be combined with --update (updates reuse the mapping recorded at install; to change environments, reinstall with --origins).'
      );
    }
    if (values.mcp != null) {
      errors.push('--mcp cannot be combined with --update (updates never touch MCP config).');
    }
    installMcp = false;
    if (agent == null && values.agent == null) {
      errors.push(`--agent is required with --update (${AGENTS.join(' | ')}).`);
    }
    if (ignoreSkill && ignoreRule) {
      errors.push('Nothing to update: both Skills and Rules are ignored.');
    } else {
      installSkillsRules = true;
    }
    if (token != null) {
      warnings.push('A token was provided but --update never needs one; the token is ignored.');
    }
    if (host != null) {
      warnings.push(`--host ${host} only affects MCP config, so it has no effect with --update.`);
    }
  }

  // Effective MCP toggle for the token-required check: in non-interactive mode an
  // unspecified toggle takes its default (on); in interactive mode it stays "ask" (null).
  const effInstallMcp = installMcp != null ? installMcp : nonInteractive ? true : null;

  // ── hard errors that depend on resolved state ───────────────────────────────
  if (!update && installMcp === false && installSkillsRules === false) {
    errors.push('Nothing to install: MCP is disabled and both Skills and Rules are ignored.');
  }
  if (nonInteractive && !update) {
    if (agent == null && values.agent == null) {
      errors.push(`--agent is required in non-interactive mode (${AGENTS.join(' | ')}).`);
    }
    if (effInstallMcp === true && token == null) {
      errors.push(
        'A Personal Access Token is required for MCP in non-interactive mode (--token or WEEGLOO_TOKEN env).'
      );
    }
  }

  // ── soft warnings (proceed anyway) ──────────────────────────────────────────
  if (!update && token != null && installMcp === false) {
    warnings.push('A token was provided but --no-mcp is set; the token is ignored.');
  }
  if (!update && host != null && installMcp === false) {
    warnings.push(`--host ${host} only affects the npx upload server, so it has no effect with --no-mcp.`);
  }
  if (showAllBranches && (refPinned || nonInteractive)) {
    warnings.push('--all-branches has no effect when the branch is pinned or non-interactive (the picker is skipped).');
  }
  // The Antigravity "--location is a no-op for MCP-only" warning depends on values
  // that may still be chosen interactively (agent/scope/toggles), so index.js emits
  // it after all prompts resolve — not here, where only flag-supplied values are known.

  return {
    errors,
    warnings,
    config: {
      nonInteractive,
      pluginRef,
      refPinned,
      agent,
      host,
      installMcp,
      mcpGroup,
      scope,
      ignoreSkill,
      ignoreRule,
      installSkillsRules,
      update,
      origins,
      token,
      showAllBranches,
    },
  };
}
