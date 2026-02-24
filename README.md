# Weegloo Plugin

This repository contains the configuration needed to integrate Weegloo with Cursor IDE and Claude Code. The plugin enables your agents to interact directly with your Weegloo workspace, allowing you to search messages, send communications, manage canvases, and more—all through natural language.

## Features

The Weegloo MCP server provides the following capabilities:

- **Search**: Find messages, files, users, and channels (both public and private)
- **Messaging**: Send messages, retrieve channel histories, and access threaded conversations
- **Canvas**: Create and share formatted documents, export content as markdown
- **User Management**: Retrieve user profiles including custom fields and status information

## Prerequisites

Before setting up the Weegloo MCP server, ensure you have:

- Cursor IDE or Claude Code CLI installed
- Access to a Weegloo workspace with MCP integration approved by your workspace admin

## Installation

Choose the installation method for your IDE:

### Claude Code

If you're using Claude Code CLI, you can install this as a plugin:

```bash
claude mcp add-from-claude-plugin /path/to/weegloo-mcp-cursor-plugin
```

Or clone the repo and install locally:

```bash
git clone https://github.com/weeglooapi/weegloo-mcp-cursor-plugin.git
cd weegloo-mcp-cursor-plugin
claude mcp add-from-claude-plugin .
```

The Weegloo MCP server will be automatically configured when the plugin loads. You will be prompted to authenticate into your Weegloo workspace via OAuth.

The Claude plugin uses the following MCP configuration (`.mcp.json`):

```json
{
  "mcpServers": {
    "weegloo": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp"
    },
    "weegloo-all": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=all"
    },
    "weegloo-core": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=core"
    },
    "weegloo-extra": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=extra"
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
    "weegloo-all": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=all"
    },
    "weegloo-core": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=core"
    },
    "weegloo-extra": {
      "type": "http",
      "url": "https://ai.weegloo.com/mcp?group=extra"
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

Save the configuration. You will also see a connect button once added. Click that to authenticate into your Weegloo Workspace.

## Usage Examples

Once configured, you can interact with Weegloo through your AI assistant using natural language:

- **Search messages**: "Search for messages about the product launch in the last week"
- **Send messages**: "Send a message to #general channel saying the deployment is complete"
- **Find users**: "Who is the user with email john@example.com?"
- **Access threads**: "Show me the conversation thread from that message"
- **Create canvases**: "Create a canvas document with our meeting notes"

## Documentation & Resources

- [Official Weegloo MCP Server Documentation](https://docs.weegloo.dev/ai/mcp-server/)

## Notes & Limitations

- **Remote server only**: This configuration connects to Weegloo's hosted MCP server. No local installation is required or supported.
- **Admin approval required**: Your Weegloo workspace administrator must approve MCP integration before you can use this feature.

## Questions or Issues?

For questions about the Weegloo MCP server or integration issues, please refer to the [official Weegloo documentation](https://docs.weegloo.dev/ai/mcp-server/) or contact your workspace administrator.
