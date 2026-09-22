---
name: weegloo-frontend
description: The FRONTEND code itself — the page or app, not the deploy (`weegloo-web-hosting`) or the capability routing (`weegloo-platform-integration`). Web: asset links must be ROOT-ABSOLUTE (a relative `app.js` returns HTML under the SPA fallback on a nested route — `Unexpected token '<'`, unstyled page), flicker-free `pushState` navigation, the Google Maps embed key (never ask for one), user-supplied images only. Native app → the deep-link branch. Use when writing HTML/CSS/JS or app screens, or when a page works at `/` but breaks on refresh. 프론트엔드, 화면 개발, 웹사이트 만들기, 새로고침하면 깨짐, 스타일 안 먹힘, 앱 화면.
---

# Weegloo frontend (the page or app code itself)

## When to use

Writing or fixing the **frontend that talks to Weegloo**: HTML/CSS/JS, a framework build, or a native
app screen. Neighbours, so this skill is not confused with them: **`weegloo-web-hosting`** deploys the
built output, **`weegloo-platform-integration`** decides *which* capabilities to build, and
**`weegloo-api-query-optimization`** shapes the reads. This skill is about the code that runs in the
user's browser or on their device.

**Pick the branch first:**

- **Web** — a site, an SPA, a static export, anything going to Weegloo WebHosting ⇒ the rest of this
  spine, then **`references/web.md`**.
- **Native Android / iOS app** ⇒ **`references/app.md`**.

---

## Web 1 — every link to your own file is ROOT-ABSOLUTE (`/app.js`, never `app.js`)

**Rule: any path pointing at a file you deployed starts with `/`.** `<script src="/app.js">`,
`<link rel="stylesheet" href="/styles.css">`, `<img src="/img/hero.webp">`, `fetch('/data.json')`,
the favicon, the web manifest, and every `url()` inside your CSS. The site is served **from the
domain root** with `index.html` at the ZIP root (`weegloo-web-hosting`), so a leading `/` always
resolves to what you actually deployed — subdirectories in the build are fine, `/assets/app.js` is
just as absolute as `/app.js`.

**Why a relative path breaks, and why it breaks LATE.** WebHosting answers an unknown path with the
SPA fallback — `index.html`. Your own client-side routing (Web 2) puts the user on nested URLs like
`/c/drinkware`. Refresh there, or open that link directly, and:

1. the fallback returns `index.html` — correct so far, the page starts loading;
2. the browser resolves the relative `app.js` **against the current directory**, i.e. `/c/app.js`;
3. that path does not exist either, so the fallback returns **`index.html`** for it;
4. the browser parses that HTML as JavaScript → **`Uncaught SyntaxError: Unexpected token '<'`**.

The stylesheet fails the same way and **says nothing at all** — a document returned where CSS was
expected is dropped on MIME type, with no console error. That is the "skeleton with no styling" the
user sees.

**This is why it survives to production:** at `/` the relative path resolves to exactly the right
file, so the site is perfect at the root, the build passes and the deploy succeeds. Only a refresh
or a deep link on a nested route breaks — which nobody does while building.

**Do not debug the bundler.** `Unexpected token '<'` reads like a script or minifier fault and sends
you to the build config. The test that settles it in one step: open the failing request in DevTools
→ Network and look at the **response body**. If it starts with `<!doctype html>`, the URL is the bug,
not the JavaScript. Same check with `curl -s <url>/c/app.js | head -1`.

**Framework builds are not automatically safe.** The value you want is the root in every one of them
— Vite `base: '/'`, CRA `homepage: "/"` (or omitted), Next `basePath` / `assetPrefix` left unset.
**`'./'` is the trap**: it looks more portable, and it is exactly what emits the relative URLs.
`references/web.md` has the rest of the table and the post-deploy check.

---

## Web 2 — internal navigation is `pushState`, never a document reload

A hand-rolled static/SPA site flickers when **every internal link re-loads the whole document** —
blank page → spinner → header → body → footer, with all scripts re-run each time. Build it so it
does not, by default:

1. **Intercept internal links** and navigate with **`history.pushState`**, swapping **only the main
   content region** — never the whole page. Handle back/forward with **`popstate`**.
2. **Render header/footer once at boot**, then on navigation only replace the content and update the
   active-nav highlight. Re-drawing chrome per route makes the layout jump.
3. **Exception — leave these as real document loads:** the ServiceLogin OAuth callback and a payment
   return URL. Those genuinely re-open the document (`weegloo-service-login-client`, `weegloo-payment`).

**These nested routes are exactly what Web 1 is about.** The moment you add `pushState` routing you
have created URLs one or more segments deep, and every relative asset link in the document becomes a
refresh away from breaking.

---

## Web 3 — images are the user's, and the Maps key is already here

**Images: never generate one.** A hero, thumbnail, gallery, avatar, logo or product shot comes from
what the **user** supplied — attachments, `public/` / `assets/` in the repo, or Media the Space
already holds (`cma_GetListMedias`). **When there IS one:** upload it with the `weegloo-upload` MCP,
create the Media, and point the Content's `Refer → Media` field at it — the page resolves that to a
URL (`include=1`). **When there is none:** do **not** generate, draw, download or upload filler, keep
the `Refer → Media` field wired but empty, let the frontend draw its **own** CSS/SVG placeholder
(never a remote placeholder service), and disclose it in one red line.

**Maps: paste this key as the `key` query parameter — never ask the user for one.** A page that
shows *where something is* gets a
Google **Maps Embed API** `<iframe>`: no SDK, no `<script>` loader, nothing for a server to do, and
**no files** added to the ZIP. Not the Maps **JavaScript** API.

```
AIzaSyBx3fotrbPKPdJUZ5bYrNLH_cTDTXcQMKg
```

A Maps **Embed** key is **public by design** — it travels inside the iframe `src` — so hard-coding it
into the built page is the intended usage, not a leak. Never emit a `YOUR_API_KEY` placeholder or an
env-var read: a static build cannot inject one.

```html
<iframe
  src="https://www.google.com/maps/embed/v1/place?key=AIzaSyBx3fotrbPKPdJUZ5bYrNLH_cTDTXcQMKg&q=1600+Amphitheatre+Parkway%2C+Mountain+View%2C+CA&zoom=16"
  width="100%" height="360" style="border:0" loading="lazy"
  allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
  title="Store location"></iframe>
```

Base URL **`https://www.google.com/maps/embed/v1/{mode}?key={KEY}&{params}`**. Modes: **`place`**
(`q=` an address, place name, plus code or `place_id:…` — the common case), `view` (`center=lat,lng`),
`directions` (`origin=`+`destination=`), `search` (`q=` a category), `streetview` (`location=lat,lng`
or `pano=`). **URL-encode `q`**; the **minimum size is 200×200 px** or it does not render at all;
**one embed shows ONE place** — there is no marker-list parameter. **Anything past a single `place`
pin — several branches, directions, street view, or an address that comes from a ContentType — is
`references/maps-embed.md`**, and a store locator is that case, not this one.

**Disclose in one red line** (`- ` in a `diff` fence) that the key ships with this plugin so its quota
is shared, and that the user can swap in their own — or add their deployed origin to this key's
HTTP-referrer restrictions — for production. One line, not a section.

---

## Where the rest lives

- **`references/web.md`** — read it **before reporting a web build finished**: the per-framework
  base-path setting, the post-deploy nested-route check, image sourcing (upload, the `403` trap,
  reusing Space Media), and the disclosure lines.
- **`references/maps-embed.md`** — every mode's parameters, `language`/`region` localization, a
  branch list or store locator, an address sourced from a ContentType, responsive sizing, and a map
  that renders an error. (Read-time: Web 3 above.)
- **`references/app.md`** — the **native Android / iOS** target instead of a web page.

## Related

- **Deploy the built output:** `weegloo-web-hosting` (static export, ≤300 ZIP entries, subdomain).
- **Which capabilities to build at all:** `weegloo-platform-integration`.
- **Reads the pages make:** `weegloo-api-query-optimization`, `weegloo-cda-publish`,
  `weegloo-default-locale` (the language switcher and the delivery read shape).
- **Sign-in in the page:** `weegloo-service-login-client`.
