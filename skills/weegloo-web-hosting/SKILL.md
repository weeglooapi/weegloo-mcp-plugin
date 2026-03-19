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
- **Format:** assign any plain object to **`window.__ENV__`**. Keys are **not** fixed by Weegloo — each app defines what it reads (document required keys in that project’s README / env template). Prefer **string** values for portability.
  - **Illustrative sample only** (e.g. a CDA-powered resume app — **you may add or omit keys** as needed):
  ```js
  window.__ENV__ = {
    WEEGLOO_CDA_BASE_URL: "https://dev-cda.weegloo.com",
    WEEGLOO_SPACE_ID: "YOUR_SPACE_ID",
    WEEGLOO_LOCALE: "en-US",
    DELIVERY_ACCESS_TOKEN: "YOUR_DELIVERY_ACCESS_TOKEN",
    // MY_OTHER_SETTING: "…",  // OK: extra keys are allowed
  };
  ```
  **Template flow:** users install from a **market/service template**, then edit **`env.js`** (or rebuild after setting CI `.env`).
- **Build vs runtime (avoid confusion):** **`npm run build` must produce a ZIP whose `./env.js` contains the real values** for that deploy. If developers keep secrets in `.env.local`, the **build pipeline should merge `.env` / `.env.local` into `out/env.js`** (see CareerResume `stage-careerresume-out.mjs`). **Do not assume** copying `public/env.js` alone is enough — without a merge step, production will ship placeholders. **In the browser**, the app reads **only** `window.__ENV__` from the loaded `./env.js` file — not live reads of `.env.local`.
- **Delivery Access Token:** for Weegloo CDA browser clients, this token is **not a “secret” in env.js** — it **must** live in **`env.js`** as **`DELIVERY_ACCESS_TOKEN`** so installers can swap it without rebuilding. Placeholder values in the repo are expected.
- **Single source of truth at runtime:** read **only** `window.__ENV__` from `./env.js` — **not** `process.env` or inlined `NEXT_PUBLIC_*` in the JS bundle for those settings.
- **Next.js App Router:** ensure `env.js` runs before app bundles (often a **post-build HTML patch** right after `<head>`; see `scripts/stage-careerresume-out.mjs` in CareerResume).

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
