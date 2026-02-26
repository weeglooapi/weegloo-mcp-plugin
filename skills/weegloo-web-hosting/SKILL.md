---
name: weegloo-web-hosting
description: Deploy a Web Project and hosts it on the web. Use when deploying a website to make it publicly accessible via Weegloo.
---

# Weegloo Deploy Website

## When to use

- When deploying a website via Weegloo

## Workflow

1. Build the web project using `index.html` as the entry point.  
   Ensure that the `env.js` file remains as a separate file and is not bundled or compressed.
   **All asset paths must be generated as relative paths starting with `./`, not absolute paths (`/`).**  
   For example, when using Vite, configure:
   ```js
   // vite.config.js
   export default defineConfig({
     base: './'
   })
   ```
   The final build output must not contain absolute paths such as /assets/....

2. Compress the build output into a ZIP archive.  
   The `index.html` file must be located at the root level of the ZIP file.

3. Use the MCP tool to create an `Upload` resource using the generated ZIP file.

4. After the `Upload` resource is successfully created, use the MCP tool to create a `WebHosting` resource based on the `Upload`.

## Instructions
- The `env.js` file must be built as a separate file without any modification or processing.
- The `index.html` file must be located at the root of the ZIP archive.

## Important
 - **Relative path usage is mandatory.**
   All static resources must reference paths starting with ./.
   If absolute paths (/) are included in the build output, the deployment may fail or the hosted website may not function correctly.
 - If you only need to update the `env.js` file, do **not** redeploy the website.  
   Instead, use the MCP tool to update the `WebHosting` resource.

## Optional Actions
- To update only the `env.js` file, you can use the MCP tool to perform the update.
- You can parse the keys and values in the `env.js` file as a map and use them as the `environments` when updating the `WebHosting` resource.
