---
name: weegloo-web-hosting
description: Use before any deploy to Weegloo WebHosting. Static-only (max 300 files in production, 100 by default). Covers ZIP layout, MCP upload, and WebHosting resource flow. ALSO covers rewriting a deployed page's `<head>` metadata — title, description, canonical, og/twitter share image, site name, favicon, theme color — through the `pageMetas` field of `cma_UpdateOneWebHosting`, where a slot left out is kept and an empty string deletes the tag. Use when changing a live site's SEO or share tags, or its favicon/theme color, without rebuilding or re-uploading — available only on a WebHosting installed from a MarketApp.
---

# Weegloo Deploy Website

## When to use

- When deploying a website via Weegloo WebHosting (MCP upload + WebHosting resource).
- **Deploy is the default finish for an "integrate Weegloo" web app.** When the integration target is
  a runnable static/SPA site and the user has **not** named another host, deploying it here — and
  reporting the live `…weegloo.app` URL — is part of *completing* the integration, not an optional
  extra. **Do not leave the app running only locally.** Skip the deploy only if the user specified
  another host, or the app genuinely cannot build to a static export.

## MANDATORY: MCP Tools Only

- **You MUST use Weegloo MCP tools for deployment.** Do NOT use `scripts/deploy-weegloo.mjs` or any deploy script.
- Use `CreateUpload` (user-weegloo-upload) for upload, and `cma_CreateWebHosting` / `cma_UpdateOneWebHosting` / `cma_GetOneWebHosting` / `cma_GetListWebHostings` (user-weegloo) for WebHosting operations.
- If the user asks to deploy, always use MCP tools-never fall back to the deploy script.

---

## Weegloo WebHosting platform limits

**Scope:** The following applies **only when production is deployed on Weegloo WebHosting**. If you host the same codebase on **your own infrastructure** (or Vercel, etc.), **SSR, API routes, and server-side calls to Weegloo are allowed**-this section does not restrict you.

1. **Static hosting only (on Weegloo).** Weegloo serves **pre-built** files from your ZIP (HTML, JS, CSS, images, etc.). **SSR, server runtimes, and per-request server logic are not supported on Weegloo WebHosting.** Use **static export** builds (e.g. Next `output: 'export'`) or other generators that output a flat/static site for the ZIP you upload.
2. **Weegloo REST from the browser.** With no app server on Weegloo, **Weegloo APIs (e.g. CDA)** used by the live site must be invoked from the **client**: **`fetch`, XHR, or other browser AJAX** to the REST base URL-not from SSR or a backend running on the WebHosting origin. (CI scripts, MCP, and CMA from dev machines are unrelated.)
3. **File count cap: 300 (production).** After unzip, the deployment **must not contain more than 300 archive entries** — directories are counted too, not just files. This is the production limit; the code default is **100**, so a build kept **≤ 100** is always safe on any environment. Heavy toolchains can emit many chunk files; if the export approaches the cap, consolidate or reconfigure the build before zipping.
4. **Fonts:** Prefer **web fonts** (e.g. Google Fonts or another link/CSS CDN). Bundling many self-hosted `.woff2` files **burns the file limit** quickly; keep self-hosted font files minimal if used at all.

---

## What the build must already satisfy before you deploy it

The page code itself is **`weegloo-frontend`** — invoke it while building, not here. Two of its rules
decide whether this deploy works at all, so check them before zipping:

1. **Every link to your own file is root-absolute** (`/app.js`, `/styles.css`, `/img/…`). This host
   answers an unknown path with the SPA fallback, so a **relative** link on a nested route
   (`/c/drinkware`) is served `index.html` — the browser then parses HTML as JavaScript
   (`Unexpected token '<'`) and silently drops the stylesheet. It works perfectly at `/`, which is
   why it reaches production.
2. **Internal links navigate with `history.pushState`**, swapping only the main content region —
   never a whole-document reload per link (the OAuth callback and a payment return URL stay real
   document loads).

**Verify #1 after deploying** by hard-refreshing a route at least one segment deep, not just the
root: the page must come back fully styled and interactive. If it does not, open the failing
`.js` / `.css` request and read its **response body** — `<!doctype html>` there means the fallback
answered and the URL is the bug. Full procedure: `weegloo-frontend`'s `references/web.md`.

---

## Static export and client configuration

**Weegloo WebHosting has no per-request server or platform-managed runtime env file.** Anything the browser needs (CDA base URL, Space id, locale, Delivery Access Token, etc.) must be supplied by **your build** (e.g. `NEXT_PUBLIC_*` at build time), **separate builds per deploy**, or another **project-defined** pattern. Document the real approach in **`.env.example`** and the project README—see **`weegloo-api-endpoints`** for API bases and token rules.

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

4. **Verify** the export tree stays within the file-count cap (see platform limits — 300 in production, 100 by default/in dev; keeping it **≤ 100** is always safe). Then **compress** the build output into a ZIP. **`index.html` at ZIP root.**

5. **CreateUpload** (MCP) with the ZIP — pass **both** `spaceId` **and** the absolute `filePath`.
   Omitting `spaceId` comes back as a **`403` permission error**, not a missing-parameter error; it
   is not a token problem (`weegloo-upload-api`).

6. **CreateWebHosting** or **UpdateOneWebHosting** (MCP) referencing that upload.

7. **Tell the user the subdomain you chose and that it is changeable.** After the WebHosting is
   created, report the resulting URL (`https://{subdomain}.weegloo.app`) and explicitly note that
   the subdomain was auto-selected to fit the service and **can be changed at any time later** (via
   `UpdateOneWebHosting`). Do not present this as a question — it is an informational notice.
   Changing it — or registering a custom domain — changes the site's **origin**, so anything pinned
   to the old one must be updated with it: the OAuth callback below, and any token carrying
   **`allowedReferrers`** (a stale list refuses every call while the token itself stays valid).

> **Hosting domain is `.weegloo.app`, NOT `.weegloo.com`.** Do not assume `.com`. Always read the
> actual host from the **`url`** field of the `CreateWebHosting` / `GetOneWebHosting` response —
> don't construct it by hand.
>
> **If the deployed app uses ServiceLogin (Google OAuth), align the callback to this real host:**
> after deploy, set **`ServiceLogin.callbackUrl`** to the WebHosting `url` (e.g.
> `https://{subdomain}.weegloo.app/`) and register the Google **Authorized redirect URI**
> `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/google`. Setting `callbackUrl` to
> a guessed `.com` host breaks login. If you must create the `ServiceLogin` before the URL is known,
> update `callbackUrl` once the WebHosting `url` is returned (full PUT `cma_UpdateOneServiceLogin`;
> note `providers` is preserved and need not be resent). See `weegloo-service-login-client`.

---

## Editing the deployed pages' `<head>` metadata (`pageMetas`)

A WebHosting **installed from a MarketApp** can have its `<head>` tags rewritten per document — title,
description, canonical, share image, site name, favicon, theme color — with no rebuild and no
re-upload. The editable documents are the ones listed in **`sys.originMetas`** (inventoried at install
time, together with each page's original values). **A WebHosting deployed from your own ZIP has no
such inventory, so meta editing is refused (`WGL422113`)** — and replacing the files with a new
`upload` clears it.

Send **`pageMetas`** on `cma_UpdateOneWebHosting` (PUT) or PATCH — one entry per document:

```json
{ "pageMetas": [ { "file": "index.html", "meta": { "title": "Acme", "image": "" } } ] }
```

**A slot has three states, not two:**

| slot value | what happens to that tag |
|---|---|
| omitted, or `null` | left exactly as it is |
| `""` (empty string) | the tag is removed |
| a value | the tag is set to it — inserted if the page never had it |

- Slots: `title`, `description`, `canonical`, `image`, `siteName`, `favicon`, `themeColor`. One slot
  drives several tags — e.g. `title` writes `<title>`, `og:title` and `twitter:title`.
- **Omitting `pageMetas` entirely changes nothing.** Unlike every other field of the PUT body it is
  not wiped, and **an entry you send is merged over the stored one, slot by slot**, while documents you
  leave out keep theirs. A partial edit is therefore safe — and `""` is the *only* way to clear a tag.
- `file` must be one of the documents in `sys.originMetas` (`WGL400081` otherwise), each file may
  appear once (`WGL400040`), and `pageMetas` **cannot ride along with a file-replacing `upload`**
  in the same request (`WGL400082`).
- Applying is **asynchronous**: the resource goes to `sys.state = PENDING`, a worker rewrites the HTML
  and purges the CDN, then `COMPLETED`. Poll `cma_GetOneWebHosting`; a WebHosting still
  `PENDING`/`PROCESSING` refuses further updates (`WGL422031`).

---

## Instructions

- The `index.html` file must be at the root of the ZIP archive.
- **Never ask the user for the subdomain.** Choose a distinctive one yourself, verify it with
  `CheckSubdomain`, deploy, then inform the user of the chosen subdomain and that it can be changed
  anytime.

## Related skills

- **The page or app code being deployed** — root-absolute asset links, `pushState` navigation,
  images, the Maps key: **`weegloo-frontend`**. Invoke it while building, not at deploy time.
- **Weegloo User login** — admin sign-in (PAT for servers, console FE popup → `postMessage` → `sessionStorage` + CMA `/me` + Space-membership check for browsers): **`weegloo-user-login`**.
