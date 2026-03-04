# weegloo

An interactive CLI to set up the Weegloo MCP plugin for Cursor IDE and Claude Code.

## Usage

```bash
npx weegloo@latest
```

Or install globally:

```bash
npm install -g weegloo
weegloo
```

### Overriding the ref (branch / tag)

Skills and Rules files are downloaded in real time from the GitHub branch or tag that corresponds 1:1 with the npm dist-tag.

| Command | `pluginRef` value | GitHub ref fetched |
|---|---|---|
| `npx weegloo@latest` | `"latest"` | branch `latest` |
| `npx weegloo@beta` | `"beta"` | branch `beta` |
| `npx weegloo@0.1.0` | `"v0.1.0"` | tag `v0.1.0` |

To fetch from a specific branch directly:

```bash
# CLI argument
npx weegloo@latest --ref some-branch

# Environment variable
WEEGLOO_REF=some-branch npx weegloo@latest
```

## Installation Flow

The CLI asks the following questions in order:

1. **Install location** — Global (`~/.cursor/`) or current project (`.cursor/`)
2. **IDE** — Cursor / Claude Code / Both
3. **Personal Access Token** — Generate from the Weegloo console
4. **MCP server group** — `default` / `core` / `extra` / `all`
5. **Skills** — Select skills to install (multi-select)
6. **Rules** — Select rules to install (multi-select)

## What Gets Installed

### Cursor
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| Skills | `~/.cursor/skills/<skill-name>/` | `.cursor/skills/<skill-name>/` |
| Rules | `~/.cursor/rules/<rule-name>.mdc` | `.cursor/rules/<rule-name>.mdc` |

### Claude Code
| Item | Path (Global) | Path (Project) |
|------|---------------|----------------|
| MCP config | `.mcp.json` (current directory) | `.mcp.json` (current directory) |
| Skills | `~/.claude/skills/<skill-name>/` | `.claude/skills/<skill-name>/` |
| Rules | `~/.claude/rules/<rule-name>.mdc` | `.claude/rules/<rule-name>.mdc` |

## Available Skills

- **weegloo-create-content-type** — Guide for creating ContentType resources
- **weegloo-web-hosting** — Guide for deploying and hosting web projects

## Available Rules

- **weegloo-global-rules** — Global MCP rules (applied to all MCP operations)
- **weegloo-web-hosting-rules** — Web hosting specific rules

## Requirements

- Node.js >= 18
- Weegloo Personal Access Token ([generate from the console](https://console.weegloo.com))

## Links

- [Weegloo Documentation](https://docs.weegloo.com/mcp-server/)
- [GitHub Repository](https://github.com/weeglooapi/weegloo-mcp-plugin)
