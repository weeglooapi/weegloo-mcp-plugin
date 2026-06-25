---
name: weegloo-web-hosting
description: Use before any deploy to Weegloo WebHosting. Static-only (max 100 files). Covers ZIP layout, MCP upload, and WebHosting resource flow.
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

> **MarketApp packaging — special build-time rules apply.** If this WebHosting may *ever* be packaged into a MarketApp later, the source Space's `sys.id`, `DeliveryAccessToken`, and any other resource `sys.id`s the client code references must be inlined into the build output as **verbatim, intact literal strings** — do not use placeholder syntax, do not hide them behind env-var indirection or runtime concatenation, do not leave them blank "because hard-coding the author's Space looks wrong". Read **`weegloo-marketapp-packaging`** **before** writing build-time config. These rules do not apply to direct deploys (the workflow below).

---

## Workflow (deploy)

1. **MANDATORY: Decide the `subdomain` yourself — do NOT ask the user.**
   - Derive a subdomain that fits the service's characteristics (its purpose, name, or theme).
     The user can change the subdomain at any time later, so do not block on their input.
   - **Make it distinctive, not a plain common noun.** A bare generic word (e.g. `shop`, `blog`,
     `market`, `portfolio`) is almost certainly already taken and will collide. Combine the theme
     with a distinguishing token — e.g. a short brand-ish coinage, a descriptive compound, or a
     short random/unique suffix — so a first-try collision is unlikely (e.g. `lunar-bakery-shop`,
     `aurora-notes-app`, `pixelforge-portfolio-7f3`).
   - Do not invent the subdomain blindly without checking availability — step 2 still applies.

2. **Verify availability with the `CheckSubdomain` MCP tool before creating the WebHosting.**
   - The subdomain must be globally unique within the service.
   - If it is already in use, **do not ask the user** — automatically pick another distinctive
     variant (e.g. add/regenerate the unique suffix) and re-check, repeating until one is free.
   - Do not create a `WebHosting` resource without passing this step.

3. **Build** the web project with `index.html` at the **export root** (`out/` for Next `output: 'export'`).

4. **Verify** the export tree contains **≤ 100 files** (see platform limits). Then **compress** the build output into a ZIP. **`index.html` at ZIP root.**

5. **CreateUpload** (MCP) with the ZIP.

6. **CreateWebHosting** or **UpdateOneWebHosting** (MCP) referencing that upload.

7. **Tell the user the subdomain you chose and that it is changeable.** After the WebHosting is
   created, report the resulting URL (`https://{subdomain}.weegloo.app`) and explicitly note that
   the subdomain was auto-selected to fit the service and **can be changed at any time later** (via
   `UpdateOneWebHosting`). Do not present this as a question — it is an informational notice.

---

## Instructions

- The `index.html` file must be at the root of the ZIP archive.
- **Never ask the user for the subdomain.** Choose a distinctive one yourself, verify it with
  `CheckSubdomain`, deploy, then inform the user of the chosen subdomain and that it can be changed
  anytime.

## Related skills

- **Weegloo User login** — admin sign-in (PAT for servers, console FE popup → `postMessage` → `sessionStorage` + CMA `/me` + Space-membership check for browsers): **`weegloo-user-login`**.
- **MarketApp packaging** — build-time rules for a WebHosting that will (or may) be packaged into a MarketApp AppBundle (inline Space `sys.id` / `DeliveryAccessToken` / resource ids as verbatim literals): **`weegloo-marketapp-packaging`**.
