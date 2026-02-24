# Weegloo Plugin

This repository contains the configuration needed to integrate Weegloo with Cursor IDE and Claude Code. The plugin enables your agents to interact directly with your Weegloo, allowing you to view, create, update, and delete resources, as well as perform nearly all actions available in the console—entirely through natural language.

## Features

The Weegloo MCP server provides the following capabilities:

- **Entity**: Supports create, read, update, and delete (CRUD) operations for all entities, including Organization, Space, ContentType, Content, and Media.
- **WebHosting**: You can deploy web projects and host them on the web.

## Prerequisites

Before setting up the Weegloo MCP server, ensure you have:

- Cursor IDE or Claude Code CLI installed
- You must be registered with Weegloo and generate a Personal Access Token in the Weegloo console in advance to authenticate with the MCP server.

## Installation

Choose the installation method for your IDE:

### Claude Code

If you're using Claude Code CLI, you can install this as a plugin:

```bash
claude mcp add-from-claude-plugin /path/to/weegloo-mcp-plugin
```

Or clone the repo and install locally:

```bash
git clone https://github.com/weeglooapi/weegloo-mcp-plugin.git
cd weegloo-mcp-plugin
claude mcp add-from-claude-plugin .
```

The Weegloo MCP server will be automatically configured when the plugin loads.

The Claude plugin uses the following MCP configuration (`.mcp.json`):

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

Follow these steps to manually configure the Weegloo MCP server in Cursor:

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

- [Official Weegloo MCP Server Documentation](https://docs.weegloo.com/mcp-server/)

## Questions or Issues?

For questions about the Weegloo MCP server or integration issues, please refer to the [official Weegloo documentation](https://docs.weegloo.dev/mcp-server/).
