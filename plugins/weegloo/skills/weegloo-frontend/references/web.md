# Web frontend — finishing checks and asset sourcing

Read this **before reporting a web build finished**. It assumes the spine (`SKILL.md`): the
root-absolute rule, why a relative path survives to production, `pushState` navigation and the Maps
key are there, not here.

## Per-framework: where the base path is decided

A hand-written `index.html` breaks because someone typed `app.js`. A framework build breaks because
the base setting emits relative or prefixed URLs — same failure, different origin.

| Build | Setting | Value for a Weegloo WebHosting deploy |
|---|---|---|
| Vite | `base` in `vite.config.*` | `'/'` (the default — breaks if set to `'./'`) |
| Next (static export) | `basePath`, `assetPrefix` | leave unset; the site is served at the domain root |
| CRA | `homepage` in `package.json` | `"/"` or omit (`"."` emits relative URLs) |
| Astro / SvelteKit | `base` in the adapter config | `'/'` |
| Hand-written HTML | the `src` / `href` you typed | start every one with `/` |

**`'./'` is the trap in all of them.** It looks more portable and is correct for a page opened from
the filesystem — which is not how the site is served.

## The check to run before saying the site is live

Deploying successfully proves nothing here; the root path works in the broken case too.

1. Open a route that is **at least one segment deep** — the nested one your own routing creates
   (`/c/drinkware`, `/products/42`), not `/`.
2. **Hard-refresh it** (or open it in a new tab, which is the same thing: a real document load).
3. The page must render **fully styled and interactive**. A skeleton with no styling is a failed
   check, not a slow load.
4. If anything is missing, open DevTools → Network, click the failing `.js` / `.css` request and
   read the **response body**. `<!doctype html>` there means the fallback answered — fix the URL,
   not the script. From a terminal: `curl -s https://<sub>.weegloo.app/c/app.js | head -1`.

Report the live URL only after this passes on a nested route.

## Images — sourcing, and why the field stays wired

The spine's verdict is *never generate one*. What that leaves you to do:

- **Look before concluding there are none.** Images the user attached, named a path to, or already
  committed to the frontend repo (`public/`, `assets/`, `static/`) are the assets to use — upload
  them with the **`weegloo-upload` MCP** (`CreateUpload` needs **both** `spaceId` and an absolute
  `filePath`; omitting `spaceId` returns a **`403`**, not a parameter error) and create the Media.
  Check the Space too: `cma_GetListMedias` may already hold exactly what the design calls for.
- **Wire the real path anyway — the placeholder is a fallback, not a substitute.** Keep the
  `Refer → Media` field, keep the UI code that resolves it to a URL (`include=1` —
  `weegloo-api-query-optimization`), and fall through to the frontend's own placeholder only when the
  field is empty. The user drops their file in later and the site shows it **with no code change**.
- **A missing image is neither a blocking input nor an inert capability.** Do not stop to ask for
  images and do not hold the turn waiting for them — ship the placeholders and carry on.

## What the completion message must carry

Two red must-know lines at most, next to the thing they belong to (`weegloo-global-rules`):

- placeholder images are drawn by the frontend and no real asset was invented;
- the Maps key ships with this plugin, so its quota is shared and the user may swap in their own.
