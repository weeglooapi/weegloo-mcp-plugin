---
name: weegloo-web-hosting
description: Deploy on Weegloo WebHosting via MCP (static-only, max 100 files). Covers ZIP layout and MCP upload / WebHosting resource flow.
---

# Weegloo Deploy Website

## When to use

- When deploying a website via Weegloo WebHosting (MCP upload + WebHosting resource).

## MANDATORY: MCP Tools Only

- **You MUST use Weegloo MCP tools for deployment.** Do NOT use `scripts/deploy-weegloo.mjs` or any deploy script.
- Use `CreateUpload` (user-weegloo-upload) for upload, and `cma_CreateWebHosting` / `cma_UpdateOneWebHosting` / `cma_GetOneWebHosting` / `cma_GetListWebHostings` (user-weegloo) for WebHosting operations.
- If the user asks to deploy, always use MCP tools-never fall back to the deploy script.

---

## Weegloo WebHosting platform limits

**Scope:** The following applies **only when production is deployed on Weegloo WebHosting**. If you host the same codebase on **your own infrastructure** (or Vercel, etc.), **SSR, API routes, and server-side calls to Weegloo are allowed**-this section does not restrict you.

1. **Static hosting only (on Weegloo).** Weegloo serves **pre-built** files from your ZIP (HTML, JS, CSS, images, etc.). **SSR, server runtimes, and per-request server logic are not supported on Weegloo WebHosting.** Use **static export** builds (e.g. Next `output: 'export'`) or other generators that output a flat/static site for the ZIP you upload.
2. **Weegloo REST from the browser.** With no app server on Weegloo, **Weegloo APIs (e.g. CDA)** used by the live site must be invoked from the **client**: **`fetch`, XHR, or other browser AJAX** to the REST base URL-not from SSR or a backend running on the WebHosting origin. (CI scripts, MCP, and CMA from dev machines are unrelated.)
3. **File count cap: 100.** After unzip, the deployment **must not contain more than 100 files** total. Heavy toolchains can emit many chunk files; if the export exceeds **100** files, consolidate or reconfigure the build before zipping.
4. **Fonts:** Prefer **web fonts** (e.g. Google Fonts or another link/CSS CDN). Bundling many self-hosted `.woff2` files **burns the file limit** quickly; keep self-hosted font files minimal if used at all.

---

## Static export and client configuration

**Weegloo WebHosting has no per-request server or platform-managed runtime env file.** Anything the browser needs (CDA base URL, Space id, locale, Delivery Access Token, etc.) must be supplied by **your build** (e.g. `NEXT_PUBLIC_*` at build time), **separate builds per deploy**, or another **project-defined** pattern. Document the real approach in **`.env.example`** and the project README—see **`weegloo-api-endpoints`** for API bases and token rules.

---

## Workflow (deploy)

1. **MANDATORY: Ask the user for the desired `subdomain`.**  
   - Do NOT assume, infer, or default the subdomain (e.g. do not use project name, `marketplace`, etc.).
   - If the user has not explicitly provided a subdomain, STOP and ask: "Enter a subdomain to use.
Your hosting URL will be https://{subdomain}.weegloo.app (e.g., market → https://market.weegloo.com)."
   - Proceed to step 2 only after the user has provided a subdomain.

2. Before proceeding, use the `CheckSubdomain` MCP tool to verify that the provided subdomain is unique.
   - The subdomain must be globally unique within the service.
   - If the tool indicates that the subdomain is already in use, stop and ask for a different subdomain.
   - Do not create a `WebHosting` resource without passing this step.

3. **Build** the web project with `index.html` at the **export root** (`out/` for Next `output: 'export'`).

4. **Verify** the export tree contains **≤ 100 files** (see platform limits). Then **compress** the build output into a ZIP. **`index.html` at ZIP root.**

5. **CreateUpload** (MCP) with the ZIP.

6. **CreateWebHosting** or **UpdateOneWebHosting** (MCP) referencing that upload.

---

## Instructions

- The `index.html` file must be at the root of the ZIP archive.

## Related skills

- **Weegloo User login** — admin sign-in (PAT for servers, console FE popup → `postMessage` → `sessionStorage` + CMA `/me` + Space-membership check for browsers): **`weegloo-user-login`**.
