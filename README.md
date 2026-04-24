# Weegloo Plugin

This repository contains the configuration needed to integrate Weegloo with Cursor IDE and Claude Code. The plugin enables your agents to interact directly with your Weegloo, allowing you to view, create, update, and delete resources, as well as perform nearly all actions available in the console—entirely through natural language.

**One plugin bundle** (`plugins/weegloo/`) is shared by both ecosystems: `skills/`, `rules/`, and `mcp.json` live only there. Claude reads `plugins/weegloo/.claude-plugin/plugin.json`; Cursor reads `plugins/weegloo/.cursor-plugin/plugin.json`. Each marketplace catalog at the repo root only lists that path (see [Cursor multi-plugin repos](https://cursor.com/docs/reference/plugins.md#multi-plugin-repositories) and [Claude marketplaces](https://code.claude.com/docs/ko/plugin-marketplaces)).

## Features

The Weegloo MCP server provides the following capabilities:

- **Entity**: Supports create, read, update, and delete (CRUD) operations for all entities, including Organization, Space, ContentType, Content, and Media.
- **WebHosting**: You can deploy web projects and host them on the web.

## Requirements

Before setting up the Weegloo MCP server, ensure you have:
- Node.js >= 18
  - `weegloo-upload` is an npm package required for file transfers with an MCP server. For more details, please refer to [weegloo-upload](https://www.npmjs.com/package/weegloo-upload)
- Cursor IDE or Claude Code CLI installed
- You must be registered with Weegloo and generate a Personal Access Token in the Weegloo console in advance to authenticate with the MCP server.

## Installation

Choose the installation method for your IDE:

### Claude Code

This repository is a [plugin marketplace](https://code.claude.com/docs/ko/plugin-marketplaces): add the marketplace, then install the `weegloo` plugin (MCP + skills ship inside `plugins/weegloo/`).

```bash
claude plugin marketplace add https://github.com/weeglooapi/weegloo-mcp-plugin
claude plugin install weegloo@weegloo-plugins
```

For MCP only from a local clone, point at the plugin root (not the repo root):

```bash
git clone https://github.com/weeglooapi/weegloo-mcp-plugin.git
claude mcp add-from-claude-plugin ./weegloo-mcp-plugin/plugins/weegloo
```

The Weegloo MCP server will be automatically configured when the plugin loads.

The plugin’s MCP configuration lives at `plugins/weegloo/.mcp.json` (repo root `.mcp.json` matches it for Cursor and other tools):

```json
{
  "mcpServers": {
    "weegloo": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp"
    },
    "weegloo-upload": {
      "command": "npx",
      "args": ["-y", "weegloo-upload"],
      "env": {
        "UPLOAD_API_URL": "https://upload.weegloo.com/v1",
        "AUTH_BEARER_TOKEN": "${PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

After completing the plugin setup, you must replace the `AUTH_BEARER_TOKEN` environment variable of the `weegloo-upload` MCP server with the `Personal Access Token` issued in advance from the Weegloo console.

### Cursor

**Cursor plugin (rules, skills, MCP):** the installable unit is `plugins/weegloo/`, per [Cursor Plugins](https://cursor.com/docs/plugins). This repo includes `.cursor-plugin/marketplace.json` at the root for team marketplaces or multi-plugin layouts. To try the plugin locally before publishing, symlink the bundle as [documented](https://cursor.com/docs/plugins#test-plugins-locally) (example: `weegloo` → `…/weegloo-mcp-plugin/plugins/weegloo`), then reload the window.

**Manual MCP only:** follow these steps if you want MCP in settings without installing the plugin bundle:

#### Step 1: Open Cursor Settings

Navigate to **Cursor → Settings → Cursor Settings** (or use the keyboard shortcut `Cmd+,` on macOS, `Ctrl+,` on Windows/Linux).

#### Step 2: Navigate to MCP Tab

In the Settings interface, click on the **MCP** tab to access MCP server configurations.

#### Step 3: Add Weegloo MCP Configuration

Add the following configuration to connect to the remote Weegloo MCP server:

```json
{
  "mcpServers": {
    "weegloo": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp"
    },
    "weegloo-upload": {
      "command": "npx",
      "args": ["-y", "weegloo-upload"],
      "env": {
        "UPLOAD_API_URL": "https://upload.weegloo.com/v1",
        "AUTH_BEARER_TOKEN": "${PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

#### Step 4: Set `Personal Access Token`

After completing the plugin setup, you must replace the `AUTH_BEARER_TOKEN` environment variable of the `weegloo-upload` MCP server with the `Personal Access Token` issued in advance from the Weegloo console.

#### Step 5: Authenticate

Save the configuration. You will also see a connect button once added. Click that to authenticate into your Weegloo.
Enter the `Personal Access Token` issued in advance from the Weegloo console.

## MCP Servers
The MCP server tool groups are as follows:

| Group | Description | URL |
|----------|----------|-----|
| {none}  | Includes the basic set of tools. | https://ai.weegloo.com/mcp |
| core  | Includes the basic tools, excluding those related to WebHosting and Tokens. | https://ai.weegloo.com/mcp?group=core |
| extra | Includes tools related to Usage, Webhooks, Tags, and Limits. | https://ai.weegloo.com/mcp?group=extra |
| all | Includes all available tools. If you register the MCP server for this group, the other MCP servers are not required. | https://ai.weegloo.com/mcp?group=all |


## Documentation & Resources

- [Official Weegloo MCP Server Documentation](https://docs.weegloo.com/#ai-mcp/mcp-overview)

## Questions or Issues?

For questions about the Weegloo MCP server or integration issues, please refer to the [official Weegloo documentation](https://docs.weegloo.com/#ai-mcp/mcp-overview).
