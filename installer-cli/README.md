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
| `-l, --location <loc>` | Install location: `project` \| `global` (default: `global`). |
| `--mcp <group>` | Install the MCP server with group: `default` \| `core` \| `extra` \| `all`. |
| `--no-mcp` | Do not install the MCP server. |
| `-t, --token <pat>` | Weegloo Personal Access Token. Also reads `WEEGLOO_TOKEN` (the flag wins). |
| `--ignore-skill` | Do not install Skills. |
| `--ignore-rule` | Do not install Rules. |
| `-y, --yes` | Non-interactive: use defaults for anything not given. |
| `--all-branches` | Show all branches in the version picker (interactive only). |
| `-h, --help` | Show this help. |

### Non-interactive mode

Triggered by `-y` **or** a non-TTY environment (piped, CI, or an agent). In this mode:

- **Defaults:** branch `latest`, MCP + Skills + Rules installed, group `default`, location `global`, all Skills and Rules selected.
- **Required:** `--agent` is always required, and a token (`--token` or `WEEGLOO_TOKEN`) is required whenever MCP is installed. Missing required values exit immediately with an error instead of hanging on a prompt.
- Conflicting or invalid flags (e.g. `--mcp` together with `--no-mcp`, nothing left to install, or an unknown enum value) also exit with a clear error.

```bash
# Fully non-interactive: MCP + Skills + Rules for Claude Code
WEEGLOO_TOKEN=… npx weegloo@latest -y --agent claude

# Skills/Rules only, no MCP (no token needed)
npx weegloo@latest -y --agent claude --no-mcp

# Pre-fill a couple of choices, get prompted for the rest (interactive)
npx weegloo@latest --agent cursor --location global
```

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

Android Studio (Gemini) supports **only remote HTTP/SSE MCP servers, not stdio** ([docs](https://developer.android.com/studio/gemini/add-mcp-server)), so only the remote `weegloo` server is written (`mcpServers.weegloo` with `httpUrl`, `headers`, `timeout`, `enabled`, `trust`, `includeTools`, `excludeTools`); the local stdio `weegloo-upload` server is **not** installed. Authentication uses the IDE's Connect (OAuth) button, so `headers` is empty (no token). Skills install to `.android-studio/skills/` and behavioral rules are merged into the project's `AGENTS.md` (single file, per-rule markers).

## Available Skills

- **weegloo-create-content-type** - Guide for creating ContentType resources
- **weegloo-web-hosting** - Guide for deploying and hosting web projects

## Available Rules

- **weegloo-global-rules** - Global MCP rules (applied to all MCP operations)
- **weegloo-web-hosting-rules** - Web hosting specific rules

## Requirements

- Node.js >= 18
- Weegloo Personal Access Token ([generate from the console](https://console.weegloo.com))

## Links

- [Weegloo Documentation](https://docs.weegloo.com/en-US/ai/tools/mcp/)
- [GitHub Repository](https://github.com/weeglooapi/weegloo-mcp-plugin)
