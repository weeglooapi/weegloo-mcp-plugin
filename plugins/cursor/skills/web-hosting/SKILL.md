---
name: web-hosting
description: Publishes a Web Project and hosts it on the web. Use when deploying a website to make it publicly accessible.
---

# Code reviewer

## When to use

- When deploying a website

## Instructions

1. Build the web project using `index.html` as the entry point.  
   Ensure that the `env.js` file remains as a separate file and is not bundled or compressed.

2. Compress the build output into a ZIP archive.  
   The `index.html` file must be located at the root level of the ZIP file.

3. Use the MCP tool to create an `Upload` resource using the generated ZIP file.

4. After the `Upload` resource is successfully created, use the MCP tool to create a `WebHosting` resource based on the `Upload`.
