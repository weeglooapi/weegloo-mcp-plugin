# weegloo

A CLI to set up the Weegloo MCP plugin for Cursor, Claude Code, Codex, Antigravity, and Android Studio — interactive by default, or fully non-interactive for agents and CI.

## Usage

```bash
npx weegloo@latest
```

Or install globally:

```bash
npm install -g weegloo
weegloo
```

## CLI options

Run with no options for the interactive installer. **Any option below pre-fills its choice and skips that prompt.** With `-y` (or in a non-TTY / piped / CI / agent environment) the installer runs fully non-interactively, prompting for nothing.

| Option | Meaning |
|---|---|
| `-b, --branch <ref>` | Plugin version/branch to install (default: `latest`). Alias of `--ref`; also reads `WEEGLOO_REF`. |
| `-a, --agent <id>` | Target IDE/agent: `cursor` \| `claude` \| `codex` \| `antigravity` \| `androidstudio`. |
| `--host <id>` | Run the agent inside a GUI host: `xcode`. Only valid with `--agent claude`/`codex`. Injects a `PATH` into the `weegloo-upload` server env so the host can find `npx` (see [GUI hosts](#gui-hosts-xcode)). |
| `-l, --location <loc>` | Install location: `project` \| `global` (default: `global`). |
| `--mcp <group>` | Install the MCP server with group: `default` \| `core` \| `extra` \| `all`. |
| `--no-mcp` | Do not install the MCP server. |
| `-t, --token <pat>` | Weegloo Personal Access Token. Also reads `WEEGLOO_TOKEN` (the flag wins). |
| `--ignore-skill` | Do not install Skills. |
| `--ignore-rule` | Do not install Rules. |
| `--origins <file>` | Origins mapping (JSON file or inline JSON) for a staging or enterprise stack (see [Origins mapping](#origins-mapping-staging--enterprise)). Also reads `WEEGLOO_ORIGINS`. Install only. |
| `--update` | Update an existing install's skills/rules, keeping your selection (see [Updating](#updating)). Requires `--agent`; never touches MCP config, so no token. |
| `-u, --uninstall` | Remove an install and restore the pre-install state (see [Uninstalling](#uninstalling)). Works offline; no token. Interactive by default; with `-y` it needs `--agent`. |
| `-y, --yes` | Non-interactive: use defaults for anything not given. |
| `--all-branches` | Show all branches in the version picker (interactive only). |
| `-h, --help` | Show this help. |

### Non-interactive mode

Triggered by `-y` **or** a non-TTY environment (piped, CI, or an agent). In this mode:

- **Defaults:** branch `latest`, MCP + Skills + Rules installed, group `default`, location `global`, all Skills and Rules selected.
- **Required:** `--agent` is always required, and a token (`--token` or `WEEGLOO_TOKEN`) is required whenever MCP is installed (never for `--update`). Missing required values exit immediately with an error instead of hanging on a prompt.
- Conflicting or invalid flags (e.g. `--mcp` together with `--no-mcp`, nothing left to install, or an unknown enum value) also exit with a clear error.

```bash
# Fully non-interactive: MCP + Skills + Rules for Claude Code
WEEGLOO_TOKEN=… npx weegloo@latest -y --agent claude

# Skills/Rules only, no MCP (no token needed)
npx weegloo@latest -y --agent claude --no-mcp

# Codex running inside Xcode Intelligence (injects PATH so Xcode can spawn npx)
WEEGLOO_TOKEN=… npx weegloo@latest -y --agent codex --host xcode

# Update an existing install (selection preserved; no token needed)
npx weegloo@latest --agent claude --location global --update

# Uninstall: remove everything the installer put there (no token needed)
npx weegloo@latest -y --agent claude --location global --uninstall

# Pre-fill a couple of choices, get prompted for the rest (interactive)
npx weegloo@latest --agent cursor --location global
```

### GUI hosts (Xcode)

When an agent runs **inside a GUI host** — e.g. Codex or Claude Code driven by Xcode 27's Intelligence — the host spawns MCP servers with the bare login `PATH` (`/usr/bin:/bin`). nvm/homebrew node installs are not on that PATH, so the `npx`-based `weegloo-upload` server fails to launch (ENOENT) and its tools silently never appear.

Selecting **Xcode** in the interactive IDE list (then choosing Claude Code or Codex), or passing `--host xcode`, writes the config to the **same standard location** as a normal Claude/Codex install (Xcode copies it from there) but adds a `PATH` entry to the `weegloo-upload` server's `env`, pinned to the bin directory of the node that ran the installer:

```toml
[mcp_servers.weegloo-upload.env]
PATH = "/Users/you/.nvm/versions/node/v18.20.8/bin:/usr/bin:/bin"
UPLOAD_API_URL = "https://upload.weegloo.com/v1"
AUTH_BEARER_TOKEN = "…"
```

`PATH` (rather than an absolute `command`) is sufficient on its own — it covers both locating `npx` and npx's `#!/usr/bin/env node` shebang. Because the path embeds the node version, **re-run the installer after a node upgrade**. `--host` has no effect on Windows (there `cmd /c npx` already resolves node next to `npx.cmd`) and only applies to `--agent claude`/`codex` (Xcode Intelligence hosts only those).

### Overriding the ref (branch / tag)

Skills and Rules files are downloaded in real time from the GitHub branch or tag that corresponds 1:1 with the npm dist-tag.

| Command | `pluginRef` value | GitHub ref fetched |
|---|---|---|
| `npx weegloo@latest` | `"latest"` | branch `latest` |
| `npx weegloo@beta` | `"beta"` | branch `beta` |
| `npx weegloo@1.0.0` | `"v1.0.0"` | tag `v1.0.0` |

To fetch from a specific branch directly:

```bash
# CLI argument (-b / --branch / --ref are equivalent)
npx weegloo@latest --branch some-branch

# Environment variable
WEEGLOO_REF=some-branch npx weegloo@latest
```

## Updating

```bash
npx weegloo@latest --agent claude --location global --update
```

This is the command the installed `weegloo-version` rule shows when a newer version is available. Unlike an install, `--update`:

- **keeps your skill/rule selection** — a partial install stays partial. A hand-deleted skill/rule is treated as drift and restored; deselecting happens by re-running the install picker.
- **auto-adds genuinely new items** — things that did not exist in the catalog when you last installed. Items you deliberately deselected stay out.
- **prunes upstream-deleted items**, and always restores the core rules (`weegloo-version`, `weegloo-terms-consent`).
- **stays on your branch** — read from the install's stamp (`ref`), not defaulted to `latest`. Pass `--branch` only to deliberately switch branches.
- **never touches MCP config**, so no token is needed and it runs unattended (no `--yes`). The one interactive question is the rare shared-file conflict when multiple agents in one project sit on different branches/origins.
- reapplies the [origins mapping](#origins-mapping-staging--enterprise) recorded at install time. `--update --origins` is rejected — changing environments is a reinstall.

If nothing is installed for that agent/scope, `--update` is a no-op with a pointer to the install command (it never silently installs everything).

## Uninstalling

```bash
# Interactive: find every install here and pick what to remove
npx weegloo@latest --uninstall

# Non-interactive: exactly this agent, at this location
npx weegloo@latest -y --agent claude --location global --uninstall
```

> `npx uninstall weegloo@latest` does **not** work — npm reads the first argument as the package to run and fails with `could not determine executable to run`. Uninstalling is a flag on this CLI, not a separate package.

`--uninstall` is the inverse of an install. It removes:

- the installed **Skills** (directories) and **Rules** (files, or the `<!-- weegloo:… -->` marker sections inside a shared `AGENTS.md` / `GEMINI.md`);
- the **`weegloo` and `weegloo-upload` MCP server entries** — and with them the Personal Access Token the installer wrote into that config;
- the **tracking state** in `.weegloo/<agent>/` (install record + version stamp);
- directories the above leaves **empty** (`.claude/skills/`, `.agents/rules/`, …) — pruned with `rmdir`, which refuses a directory that still holds anything.

What it does **not** touch:

- **anything the install record does not claim.** The per-agent record is the only authority on what the installer put there. A `weegloo-*` name found on disk that the record does not list is reported as **unverified** and never removed unless you pick it out by name — it may well be your own file (a repo-authored `weegloo-npm-publish` skill was deleted this way before this rule existed). `-y` never removes unverified items at all; it names what it skipped.
- **files it cannot prove it created.** Config and context files — `.mcp.json`, `config.toml`, `AGENTS.md`, `GEMINI.md` — are only ever *edited*: our entries and marker sections come out, the file stays, even when that leaves it empty. Other MCP servers and unrelated settings in the same file are preserved.
- **files another agent still uses.** `.agents/skills` and `<cwd>/AGENTS.md` are physically shared, so an id another agent's record still claims is left alone and only this agent's tracking lets go of it. Uninstall the last claimer and the file is finally freed.
- **the Codex project-trust entry**, a Claude Code marketplace plugin, or **the PAT itself** — none of those are the installer's file writes (or they live in your account). They are reported at the end with what to do about them.

Interactive runs detect every install in the current project and your home directory, list what each holds, and **name every item** before deleting anything (a bare count is unrecognizable). An install seen only in a file shared with another agent is offered *unchecked*, and unverified items get their own separate, unchecked question after the main confirmation. `-y` skips every prompt and removes exactly `--agent` at `--location` (default `global`).

Removal is driven by the install record plus a disk scan, so it needs **no network, no branch and no token** — an install whose branch is long gone still uninstalls cleanly. Re-running it is a clean no-op.

Partial removal reuses the install-mode opt-outs, which read the same way ("leave this kind alone"):

```bash
# drop the skills/rules but keep the MCP server configured
npx weegloo@latest -y --agent claude --uninstall --no-mcp

# unhook the MCP server but keep the guidance files
npx weegloo@latest -y --agent claude --uninstall --ignore-skill --ignore-rule
```

Detection can only see the **current project** and your **home directory**. An install made inside another project folder has to be uninstalled from that folder.

## Origins mapping (staging / enterprise)

For a staging stack or an enterprise deployment on customer domains, pass a JSON mapping of weegloo origins at install time. All fetched content (skill files, rule text, MCP config URLs, the version-check URL baked into the `weegloo-version` rule) is rewritten before it is written to disk — repo sources are never modified.

```bash
npx weegloo@latest --agent claude --origins ./origins.acme.json --token <PAT>
```

```jsonc
// origins.acme.json — partial mappings are fine (e.g. staging may replace only cda)
{
  "cma":     "https://cma.acme.com",
  "cda":     "https://cda.acme.com",
  "acma":    "https://acma.acme.com",
  "acda":    "https://acda.acme.com",
  "upload":  "https://upload.acme.com",
  "auth":    "https://auth.acme.com",
  "console": "https://console.acme.com",
  "ai":      "https://ai.acme.com"
}
```

The mapping sticks to the install — `--update` reapplies it automatically. To change environments (or go back to production), reinstall.

## Installation Flow

In interactive mode the CLI asks the following questions in order (a flag from [CLI options](#cli-options) can pre-fill any of them, skipping that prompt):

1. **Install location** - Global (`~/.cursor/`) or current project (`.cursor/`)
2. **IDE** - Cursor / Claude Code / Codex / Antigravity / Android Studio
3. **Personal Access Token** - Generate from the Weegloo console
4. **MCP server group** - `default` / `core` / `extra` / `all`
5. **Skills** - Select skills to install (multi-select)
6. **Rules** - Select rules to install (multi-select)

## What Gets Installed

### Cursor
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | macOS: `~/Library/Application Support/Cursor/mcp.json` · Windows: `%APPDATA%\Cursor\mcp.json` · Linux: `~/.config/Cursor/mcp.json` | `.cursor/mcp.json` |
| Skills | `~/.cursor/skills/<skill-name>/` | `.cursor/skills/<skill-name>/` |
| Rules | `~/.cursor/rules/<rule-name>.mdc` | `.cursor/rules/<rule-name>.mdc` |

### Claude Code
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | `~/.claude.json` | `.mcp.json` (project root) |
| Skills | `~/.claude/skills/<skill-name>/` | `.claude/skills/<skill-name>/` |
| Rules | `~/.claude/rules/<rule-name>.md` | `.claude/rules/<rule-name>.md` |

### Codex
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | `~/.codex/config.toml` | `.codex/config.toml` |
| Skills | `~/.agents/skills/<skill-name>/` | `.agents/skills/<skill-name>/` |
| Instructions | `~/.codex/AGENTS.md` | `AGENTS.md` |

Codex writes `mcp_servers.weegloo` (HTTP URL) and `mcp_servers.weegloo-upload` (npx + env with your Personal Access Token). Multiple Weegloo instruction rules are merged into `AGENTS.md` with stable markers (re-runs update sections by rule id). Codex's own `.rules` files are for command approval policy, not agent instructions.

**Project installs also register the project as trusted** in `~/.codex/config.toml` (`[projects."<dir>"] trust_level = "trusted"`): Codex [only loads project-scoped `.codex/` config for trusted projects](https://developers.openai.com/codex/config-basic), so without this entry the MCP servers written to `.codex/config.toml` would be silently ignored (and `codex mcp login weegloo` would fail with "No MCP server named 'weegloo' found"). An existing `[projects."<dir>"]` entry — including an explicit `untrusted` decision — is never modified; the installer warns instead.

Codex path rationale: Codex discovers persistent instructions from `AGENTS.md` / `AGENTS.override.md` files ([docs](https://developers.openai.com/codex/guides/agents-md)), and discovers skills from `.agents/skills` and `~/.agents/skills` ([docs](https://developers.openai.com/codex/skills)). Codex `.rules` files control sandbox approval policy, so Weegloo behavioral rules are installed as `AGENTS.md` instructions instead ([docs](https://developers.openai.com/codex/rules)).

### Antigravity
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| Skills | `~/.gemini/skills/<skill-name>/` | `.agents/skills/<skill-name>/` |
| Rules | `~/.gemini/GEMINI.md` | `AGENTS.md` (project root) |

Antigravity writes `mcpServers.weegloo` (HTTP URL via `serverUrl`) and `mcpServers.weegloo-upload` (npx + env with your Personal Access Token) into `mcp_config.json`. Behavioral rules are **not** written as separate files: they are merged into Antigravity's context file — `GEMINI.md` for a global install, `AGENTS.md` for a project install — with stable per-rule markers, so re-running the installer updates each section in place instead of duplicating content. `GEMINI.md` is Antigravity's global context file; `AGENTS.md` is the portable project context file (also read by other agents).

### Android Studio
**Project-only** — Android Studio has no global install (`--location global` is normalized to the current project).

| Item | Path |
|------|------|
| MCP config | `mcp.json` in Android Studio's version-specific config dir (e.g. Windows: `%APPDATA%\Google\AndroidStudio<ver>\` · macOS: `~/Library/Application Support/Google/AndroidStudio<ver>/` · Linux: `~/.config/Google/AndroidStudio<ver>/`); the newest `AndroidStudio*` dir is auto-detected |
| Skills | `.android-studio/skills/<skill-name>/` (project root) |
| Rules | `AGENTS.md` (project root) |

Android Studio writes **both** MCP servers into `mcp.json` ([docs](https://developer.android.com/studio/gemini/add-mcp-server)): the remote `mcpServers.weegloo` (with `httpUrl`, `headers`, `timeout`, `enabled`, `trust`, `includeTools`, `excludeTools`) and the local stdio `mcpServers.weegloo-upload` (npx + env with your Personal Access Token). The remote `weegloo` server authenticates with the Personal Access Token sent directly as an `Authorization: Bearer` header (no Connect/OAuth step); `weegloo-upload` authenticates with the same PAT in its env. Skills install to `.android-studio/skills/` and behavioral rules are merged into the project's `AGENTS.md` (single file, per-rule markers).

## Available Skills and Rules

The full, current catalog (20+ skills, 7 rules) is shown in the interactive picker and lives in [`plugins/weegloo/`](https://github.com/weeglooapi/weegloo-mcp-plugin/tree/latest/plugins/weegloo) — it changes with every release, so it is not duplicated here. Two rules are core and always installed: `weegloo-version` (the update notifier) and `weegloo-terms-consent` (the terms gate).

## Requirements

- Node.js >= 18
- Weegloo Personal Access Token ([generate from the console](https://console.weegloo.com))

## Links

- [Weegloo Documentation](https://docs.weegloo.com/en-US/ai/tools/mcp/)
- [GitHub Repository](https://github.com/weeglooapi/weegloo-mcp-plugin)
