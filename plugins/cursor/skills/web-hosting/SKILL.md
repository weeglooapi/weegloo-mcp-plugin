---
name: web-hosting
description: Publishes a Web Project and hosts it on the web. Use when deploying a website to make it publicly accessible.
---

# Deploying Website

## When to use

- When deploying a website

## Workflow

1. Build the web project using `index.html` as the entry point.  
   Ensure that the `env.js` file remains as a separate file and is not bundled or compressed.

2. Compress the build output into a ZIP archive.  
   The `index.html` file must be located at the root level of the ZIP file.

3. Use the MCP tool to create an `Upload` resource using the generated ZIP file.

4. After the `Upload` resource is successfully created, use the MCP tool to create a `WebHosting` resource based on the `Upload`.

## Instructions
- The `env.js` file must be built as a separate file without any modification or processing.
- The `index.html` file must be located at the root of the ZIP archive.

## Important
If you only need to update the `env.js` file, do **not** redeploy the website.  
Instead, use the MCP tool to update the `WebHosting` resource.

## Optional Actions
- To update only the `env.js` file, you can use the MCP tool to perform the update.
- You can parse the keys and values in the `env.js` file as a map and use them as the `environments` when updating the `WebHosting` resource.
