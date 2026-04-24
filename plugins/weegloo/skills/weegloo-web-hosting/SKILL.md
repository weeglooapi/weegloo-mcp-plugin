---
name: weegloo-web-hosting
description: Deploy on Weegloo WebHosting via MCP (static-only, max 100 files, env.js). Covers ZIP layout, Next.js .env mapping, and runtime config.
---

# Weegloo Deploy Website

## When to use

- When deploying a website via Weegloo WebHosting (MCP upload + WebHosting resource).

## MANDATORY: MCP Tools Only

- **You MUST use Weegloo MCP tools for deployment.** Do NOT use `scripts/deploy-weegloo.mjs` or any deploy script.
- Use `CreateUpload` (user-weegloo-upload) for upload, and `cma_CreateWebHosting` / `cma_UpdateOneWebHosting` / `cma_GetOneWebHosting` / `cma_GetListWebHostings` (user-weegloo) for WebHosting operations.
- If the user asks to deploy, always use MCP tools—never fall back to the deploy script.

---

## Weegloo WebHosting platform limits

**Scope:** The following applies **only when production is deployed on Weegloo WebHosting**. If you host the same codebase on **your own infrastructure** (or Vercel, etc.), **SSR, API routes, and server-side calls to Weegloo are allowed**—this section does not restrict you.

1. **Static hosting only (on Weegloo).** Weegloo serves **pre-built** files from your ZIP (HTML, JS, CSS, images, etc.). **SSR, server runtimes, and per-request server logic are not supported on Weegloo WebHosting.** Use **static export** builds (e.g. Next `output: 'export'`) or other generators that output a flat/static site for the ZIP you upload.
2. **Weegloo REST from the browser.** With no app server on Weegloo, **Weegloo APIs (e.g. CDA)** used by the live site must be invoked from the **client**: **`fetch`, XHR, or other browser AJAX** to the REST base URL—not from SSR or a backend running on the WebHosting origin. (CI scripts, MCP, and CMA from dev machines are unrelated.)
3. **File count cap: 100.** After unzip, the deployment **must not contain more than 100 files** total. Heavy toolchains can emit many chunk files; if the export exceeds **100** files, consolidate or reconfigure the build before zipping.
4. **Fonts:** Prefer **web fonts** (e.g. Google Fonts or another link/CSS CDN). Bundling many self-hosted `.woff2` files **burns the file limit** quickly; keep self-hosted font files minimal if used at all.

---

## Next.js (and similar) — `.env` vs Weegloo `env.js`

**Two different lifecycles:**

| Context | Where values live | When they apply |
|--------|-------------------|-----------------|
| **Local `next dev` / CI build** | `.env.local`, `.env`, `.env.example` — especially `NEXT_PUBLIC_*` | Next inlines `NEXT_PUBLIC_*` into the **client bundle at build time** (or reads `process.env` on the server during dev/SSR). |
| **Weegloo WebHosting (static ZIP)** | **`./env.js`** next to `index.html` | **No Node server** at request time. The browser only loads static files. **`process.env` and `.env.local` do not exist in the user’s browser.** |

**What LLMs should implement for a static export + Weegloo:**

1. **Document a key map** from `.env.example` names → `window.__ENV__` keys (they are **not** the same string; see table below).
2. **Ship a template `public/env.js`** (or generate `out/env.js` in a post-build step) so the export root always contains `./env.js`.
3. **Load `env.js` before the app bundle** — use a **synchronous** tag **without** `async`/`defer`, **or** (recommended for **Next.js App Router**) **`next/script`** with **`strategy="beforeInteractive"`** so `/env.js` is not queued **after** Next’s async `<head>` chunks. Plain `./env.js` next to `index.html` is fine for non-Next stacks.
4. **Read config at runtime in the browser** from `window.__ENV__` **first**, then fall back to `process.env.NEXT_PUBLIC_*` for local development only. Prefer doing this in **functions called when making API calls**, not only once at module top level, so load order is safe.

**Example mapping (one Weegloo CDA–style product — not a closed key list):**

The table below is **only** for apps that choose those names. **`window.__ENV__` may contain any number of additional keys** the product needs (`FEATURE_X_ENABLED`, `ANALYTICS_ID`, third-party URLs, etc.). Weegloo Hosting does **not** validate or whitelist keys—it serves the file as static JS.

| `.env` / `.env.example` (Next) | `window.__ENV__` key in `env.js` |
|-------------------------------|----------------------------------|
| `NEXT_PUBLIC_WEEGLOO_CDA_BASE_URL` | `WEEGLOO_CDA_BASE_URL` |
| `NEXT_PUBLIC_WEEGLOO_SPACE_ID` | `WEEGLOO_SPACE_ID` |
| `NEXT_PUBLIC_WEEGLOO_LOCALE` | `WEEGLOO_LOCALE` |
| `NEXT_PUBLIC_WEEGLOO_DELIVERY_ACCESS_TOKEN` | `DELIVERY_ACCESS_TOKEN` |

- Prefer **string** values for portability and simpler MCP parsing; other JSON-serializable scalars may be used if the app agrees.
- **`DELIVERY_ACCESS_TOKEN`** here mirrors `NEXT_PUBLIC_WEEGLOO_DELIVERY_ACCESS_TOKEN`; the rename is a **convention**, not a platform rule.

**Operator workflow:** copy real values from `.env.local` (or console) into **`env.js`** on the deployed site, **or** regenerate `out/env.js` before zipping so CI writes the file. **Do not** assume a placeholder-only `public/env.js` is enough for production unless a merge/generate step fills in secrets.

**Next.js App Router caveat:** the framework injects many **async** scripts in `<head>`. A manual `<script src="/env.js">` can end up **after** them and race hydration. Prefer **`beforeInteractive`** (see above) or a **post-build HTML patch** that inserts a sync `./env.js` as the **first** executable script if `beforeInteractive` is unavailable.

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
   - Ensure **`env.js`** exists at **`./env.js`** next to `index.html` (e.g. from `public/env.js` copied by Next, or from a small **post-build script** that writes `out/env.js` from `.env.local` / CI vars).

4. **Verify** the export tree contains **≤ 100 files** (see platform limits). Then **compress** the build output into a ZIP. **`index.html` at ZIP root.**

5. **CreateUpload** (MCP) with the ZIP.

6. **CreateWebHosting** or **UpdateOneWebHosting** (MCP) referencing that upload.

---

## Runtime `env.js` (shape)

### What `env.js` is

- A **plain browser script** (not an ES module: **no** `import` / `export`) shipped next to `index.html`.
- Its job is to assign a **single global object**: **`window.__ENV__`**, which holds **per-deploy / per-tenant** configuration the static app reads **at runtime**.
- **Weegloo** does not interpret the object: any keys are between **the template author and the app code**. There is **no** fixed schema or maximum number of keys.

### File placement and loading

- **Path:** `./env.js` at the **ZIP root** (same folder as `index.html`). Browsers request it as **`/env.js`** when the site is served from the origin root.
- **Load order:** Must run **before** code that reads `window.__ENV__` (see the Next.js **`beforeInteractive`** guidance earlier). Goal: when your app’s first `fetch` or config getter runs, **`window.__ENV__` is already assigned**.

### Shape of `window.__ENV__`

- **Type:** a **plain object** (object literal). Assign with  
  **`window.__ENV__ = { ... };`**
- **Keys:** **Unrestricted.** Use whatever names the product and `.env.example` / README document. The snippet below shows **one** CDA-oriented example so LLMs see valid **syntax**—it is **not** an allowlist. Add `MY_CUSTOM_KEY`, feature flags, extra API bases, etc., as required.
- **Values:** Prefer **strings** (easy to edit, easy to parse for MCP). Booleans and numbers are acceptable if the app reads them consistently. Avoid nested objects unless the app explicitly supports them (keep templates simple unless needed).
- **Comments:** `// ...` in `env.js` is fine for humans; **MCP or tools that parse** `env.js` into key/value maps should **strip comments** first.

### Build pipeline

- **Do not** pass `env.js` through the app bundler (webpack, Turbopack, etc.). Treat it as a **static asset** (e.g. Next **`public/env.js`** → **`out/env.js`**).
- If the repo ships a **template** with placeholders, document that **operators or CI** must replace values before production, or generate `out/env.js` in a post-build step.

### Security expectations (public by design)

- Anything in `env.js` is **visible to every visitor** (“View source” / Network tab). Do **not** put credentials that must stay server-only here.
- **Delivery Access Token** in browser-facing apps is intentionally exposed in this pattern (installers paste it into `env.js`); treat it as a **scoped, rotatable** token, not a password.

### Hosted runtime vs `.env.local`

- **On Weegloo:** the app should treat **`window.__ENV__`** (from loaded `env.js`) as the **source of truth** for deploy-specific values.
- **Local dev** may still use **`.env.local`** / **`NEXT_PUBLIC_*`**, with code paths that **prefer `window.__ENV__` when present** (see earlier section).

### Illustrative sample only (extra keys welcome)

The following block demonstrates **format only**. **Omit, rename, or add** properties freely per user and product requirements.

```js
window.__ENV__ = {
  WEEGLOO_CDA_BASE_URL: "https://cda.weegloo.com",
  WEEGLOO_SPACE_ID: "YOUR_SPACE_ID",
  WEEGLOO_LOCALE: "en-US",
  DELIVERY_ACCESS_TOKEN: "YOUR_DELIVERY_ACCESS_TOKEN",
  // MY_FEATURE_FLAG: "1",
  // OTHER_VENDOR_URL: "https://example.com",
};
```

---

## Instructions

- Commit a **template** `public/env.js` and verify **`next build`** places **`out/env.js`**.
- Optionally add **`npm` postbuild** to overwrite `out/env.js` from `.env.local` / environment variables so ZIP uploads always contain the right values.
- The `index.html` file must be at the root of the ZIP archive.

## Important

- If you only need to update **`env.js`** values, prefer **WebHosting update** (MCP) with parsed `environments` — **not** a full redeploy, when the product flow allows it.
- Parse pattern: `window.__ENV__ = { ... };` — strip comments if parsing for MCP.

## Optional Actions

- Parse `env.js` key/value pairs and pass them as `environments` when calling WebHosting update MCP tools, if the tool supports that mapping.

## Related skills

- **Browser admin login** (console popup, `postMessage`, `sessionStorage`, CMA `/me` + space membership): **`weegloo-web-hosting-fe-login`**.
