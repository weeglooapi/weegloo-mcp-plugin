---
name: weegloo-web-hosting
description: Deploy a Web Project and hosts it on the web. Use when deploying a website to make it publicly accessible via Weegloo.
---

# Weegloo Deploy Website

## When to use

- When deploying a website via Weegloo

## MANDATORY: MCP Tools Only

- **You MUST use Weegloo MCP tools for deployment.** Do NOT use `scripts/deploy-weegloo.mjs` or any deploy script.
- Use `CreateUpload` (user-weegloo-upload) for upload, and `cma_CreateWebHosting` / `cma_UpdateOneWebHosting` / `cma_GetOneWebHosting` / `cma_GetListWebHostings` (user-weegloo) for WebHosting operations.
- If the user asks to deploy, always use MCP tools—never fall back to the deploy script.

## Workflow

1. **MANDATORY: Ask the user for the desired `subdomain`.**  
   - Do NOT assume, infer, or default the subdomain (e.g. do not use project name, `marketplace`, etc.).
   - If the user has not explicitly provided a subdomain, STOP and ask: "Enter a subdomain to use.
Your hosting URL will be https://{subdomain}.weegloo.app (e.g., market → https://market.weegloo.com)."
   - Proceed to step 2 only after the user has provided a subdomain.

2. Before proceeding, use the `CheckSubdomain` MCP tool to verify that the provided subdomain is unique.
   - The subdomain must be globally unique within the service.
   - If the `CheckSubdomain` tool indicates that the subdomain is already in use, the process must stop and the user must provide a different subdomain.
   - Do not attempt to create a `WebHosting` resource without passing this validation step.

3. Build the web project using `index.html` as the entry point.  
   Ensure that **`env.js`** is shipped as a **separate static file** at **`./env.js`** next to `index.html` (not bundled or minified by the app bundler).

### Runtime `env.js` (required shape for LLMs)

- **Location:** `./env.js` at the **root of the ZIP** (same folder as `index.html`).
- **Load order:** Add `<script src="./env.js"></script>` **early in `<head>`**, synchronously, **before** any app JS so globals exist at startup.
- **Format:** assign a plain object:
  ```js
  window.__ENV__ = {
    NEXT_PUBLIC_SOME_KEY: "value",
    NEXT_PUBLIC_OTHER: "",
  };
  ```
  Use **double-quoted strings** for keys and values. Keys should mirror **`NEXT_PUBLIC_*`** names the app reads at runtime.
- **Dev vs prod:** Repository may use `.env.local` for local dev; **hosted sites** rely on **`env.js`** so humans can change values without rebuilding.
- **Next.js App Router:** ensure `env.js` runs before app bundles (often requires a **post-build HTML patch** inserting `<script src="./env.js"></script>` right after `<head>`; see `scripts/stage-careerresume-out.mjs` in CareerResume).

4. Compress the build output into a ZIP archive.  
   The `index.html` file must be located at the root level of the ZIP file.

5. Use the MCP tool to create an `Upload` resource using the generated ZIP file.

6. After the `Upload` resource is successfully created, use the MCP tool to create a `WebHosting` resource based on the `Upload`.

## Instructions
- The `env.js` file must ship **verbatim** as static content (no bundling). Prefer committing a template in `public/env.js` (or equivalent) so exports include it automatically.
- The `index.html` file must be located at the root of the ZIP archive.

## Important
 - If you only need to update the `env.js` file, do **not** redeploy the website.  
   Instead, use the MCP tool to update the `WebHosting` resource.

## Optional Actions
- To update only the `env.js` file, you can use the MCP tool to perform the update.
- You can parse the keys and values in the `env.js` file as a map and use them as the `environments` when updating the `WebHosting` resource.
