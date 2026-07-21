---
name: weegloo-service-login-sdk
description: How to add Weegloo ServiceLogin (OAuth 2.0 — Google, GitHub, Facebook, GitLab, LINE, Kakao, or Naver) sign-in to a browser app — the official npm SDK `weegloo-service-user` (vanilla JS, 0 deps) and the underlying `auth.weegloo.com` HTTP wire protocol (login redirect, exchangeToken POST, refresh, logout), all parameterized by `{provider}`, inferred from the product (not asked, and with no built-in default — never reflexively reach for Google, and never apply one provider's console steps to another). Covers the entry-URL vs provider redirect-URI confusion, ACMA current user at GET https://acma.weegloo.com/v1/me (not /spaces/{spaceId}/me), the browser GET-with-body limitation, and the `exchangeToken` URL-stripping security pattern. This is the provider-agnostic spine; detailed per-provider console steps live in dedicated skills for Google (`weegloo-service-login-google`), GitHub (`weegloo-service-login-github`), Kakao (`weegloo-service-login-kakao`), Naver (`weegloo-service-login-naver`), and LINE (`weegloo-service-login-line`); Facebook and GitLab follow the same generic shape described here (no dedicated skill). Use when wiring sign-in for a Weegloo Space's product, debugging the OAuth callback flow, or implementing the protocol where the JS SDK cannot run (server-side, native mobile, scripts). For native apps (Android/iOS), also covers the `callbackUrl` http/https-only limit (no custom deep-link scheme) and the Weegloo WebHosting bridge page that redirects the OAuth callback into the app's deep link.
---

# Weegloo - ServiceLogin SDK / OAuth wire protocol

This skill covers the **implementation layer** of Weegloo ServiceLogin: the official browser SDK, the exact HTTP endpoints on `auth.weegloo.com`, and the browser-specific gotchas that bite first-time integrators.

> **Prerequisite gate:** this is the *implementation* skill. If you have **not** yet invoked **`weegloo-service-login`** (the conceptual model — `ServiceLogin` / `ServiceUserRole` / `ServiceUser`, `defaultRole` / `roleOverride` / `isAdmin`, ACMA/ACDA scope, the CMA/CDA token boundary), **read it first**. Landing here for a concrete question (e.g. "what redirect URI?") does **not** mean the design decisions are settled — do not create a `ServiceLogin` / `ServiceUserRole` having only read this skill.

For the **conceptual model** - what `ServiceLogin` / `ServiceUserRole` / `ServiceUser` are, how `roleOverride` and `isAdmin` work, ACMA/ACDA scope rules - see the **`weegloo-service-login`** skill.

For Weegloo base-URL conventions and the vendor JSON media type - see the **`weegloo-api-endpoints`** rule.

## Recommended path: use the official SDK

Browser apps (static sites, Weegloo WebHosting, SPAs, Next.js, etc.) should use the **`weegloo-service-user`** npm package. It encapsulates every step described below - login redirect, callback handling, token storage, auto-refresh, ACMA/ACDA `Authorization` injection, and the `exchangeToken` security stripping.

- npm: `https://www.npmjs.com/package/weegloo-service-user`
- CDN (Weegloo-hosted, served from `https://weegloo-media.com/static/libs/service-login/`):
  - **Latest aliases** - always serve the newest build; convenient for prototyping:
    - `service-login.js` (UMD)
    - `service-login.esm.js` (ESM)
    - `service-login.min.js` (UMD, minified)
  - **Pinned (hashed) builds** - recommended for **production**, immune to silent upgrades:
    - `service-login.<hash>.js` / `service-login.<hash>.esm.js` / `service-login.<hash>.min.js`
    - Example for v1.1.0:
      - `service-login.4ba25e91.js`
      - `service-login.51817f08.esm.js`
      - `service-login.7f47bcb0.min.js`
  - **Version manifest** (current hashes per version): `https://weegloo-media.com/static/libs/service-login/manifest.json`
    - Look up the hash for the version you want to pin, then load the matching `.<hash>.js` URL above.
- Source: vanilla JavaScript, zero runtime dependencies, ships UMD + ESM + minified

> **Production guidance:** prefer a **pinned hashed** URL so a CDN refresh cannot ship a new SDK build into a deployed product without your release. Use the latest alias only in development / prototypes. The previous `cdn.jsdelivr.net/npm/weegloo-service-user@1/...` URL has been retired - migrate to the URLs above.

Minimal usage (latest alias - dev / prototype):

```html
<script src="https://weegloo-media.com/static/libs/service-login/service-login.min.js"></script>
<script>
  const auth = WeeglooServiceLogin.init({ spaceId: 'YOUR_SPACE_ID', provider: 'google' }); // provider = the one you inferred

  // On the callback page:
  if (location.search.includes('exchangeToken=')) {
    auth.handleCallback().catch(console.error);
  }

  // Anywhere afterwards:
  document.querySelector('#login').onclick  = () => auth.login();
  document.querySelector('#logout').onclick = () => auth.logout();
  // auth.fetch() injects Authorization: Bearer <accessToken> automatically
  const res = await auth.fetch(`https://acda.weegloo.com/v1/spaces/${spaceId}/contents`);
```

Pinned version (production - replace `<hash>` with the value from `manifiest.json`):

```html
<script src="https://weegloo-media.com/static/libs/service-login/service-login.<hash>.min.js"></script>
```

ESM / bundler:

```bash
npm install weegloo-service-user
```
```js
import WeeglooServiceLogin from 'weegloo-service-user';
const auth = WeeglooServiceLogin.init({ spaceId: 'YOUR_SPACE_ID', provider: 'google' }); // provider = the one you inferred
```

**Decision aid:** if the integration runs in a browser at all, prefer the SDK. Re-implement the protocol manually only when the platform makes it impossible (e.g. a native mobile app, a server-to-server token swap, or a scripted backfill).

> **Provider selection:** the **`provider`** init option chooses the OAuth provider — its SDK default is **`'google'`**, but that default is the SDK's, not a design default. **Set `provider` explicitly to the one you inferred for the product** (see *Configuration responsibilities*); don't rely on the default, and don't ask the user merely to pick one.

## OAuth wire protocol on `auth.weegloo.com`

All paths are under `/v1/spaces/{spaceId}/...`. All bodies and responses are JSON.

### 1. Login entry - browser navigates here

```
GET https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/{provider}
```

- `{provider}` is one of Weegloo's supported providers — currently **`google`**, **`github`**, **`facebook`**, **`gitlab`**, **`line`**, **`kakao`**, **`naver`**. **Infer it from the product; do NOT ask the user to pick a provider, and do NOT treat any provider as the built-in default** (don't reflexively reach for `google`). If the product names/implies a specific one (e.g. a "Sign in with GitHub" button), use that; if nothing indicates a provider, **reason about which fits this product best and choose that** — then **surface the choice when you ask for its `clientId`/`clientSecret`** (that request reveals which provider you picked and lets the user redirect), so no separate "which provider?" question is needed. The only thing to avoid is wiring one provider's flow as another's, or giving Google's console steps for a non-Google product. (Confirm the current set from the `ServiceLogin` schema / docs if unsure.)
- This is a **navigation** target, not an XHR/fetch call - assign it to `window.location` so the browser follows the OAuth redirect chain.
- After provider sign-in, Weegloo redirects the browser to the `callbackUrl` registered on the `ServiceLogin` resource, appending `?exchangeToken=<one-time-code>`.

### 2. Token exchange - first thing on the callback page

```
POST https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/token
Content-Type: application/json

{ "exchangeToken": "<value-from-query-string>" }
```

Successful response:

```json
{
  "accessToken":       "...",
  "tokenType":         "Bearer",
  "scope":             ["SERVICE_OAUTH_ACCESS_TOKEN"],
  "createdAt":         "2026-04-16T12:12:21.602Z",
  "expiresAt":         "2026-06-16T12:12:21.602Z",
  "refreshToken":      "...",
  "refreshExpiresAt":  "2026-04-23T12:12:21.602Z"
}
```

The `accessToken` is the Bearer Token usable against ACMA / ACDA - **not** CMA / CDA (see **`weegloo-service-login`** for the scope rule).

### 3. Refresh - before `expiresAt`

```
POST https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/refresh
Content-Type: application/json

{ "refreshToken": "..." }
```

Returns the same shape as the exchange response. Some refresh responses may omit `refreshToken` - preserve the previously stored one in that case.

### 4. Logout

```
DELETE https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/token
Content-Type: application/json

{ "refreshToken": "..." }
```

Sending `refreshToken` is **strongly recommended** so the server can revoke it. Calling without a body is permitted but leaves the refresh token usable until natural expiry.

## Critical pitfalls

### A. Login entry URL ≠ the provider redirect URI

These two URLs differ by one path segment and are routinely confused:

| URL | Who calls it | Where it is configured |
|---|---|---|
| `…/login/oauth2/{provider}` | The end user's **browser** (the SDK's `auth.login()` navigates here) | - |
| `…/login/oauth2/code/{provider}` | **The provider → Weegloo** as the OAuth code callback | The provider's developer console → "Authorized redirect URIs" |

If you put `/code/` in the user-facing entry URL, the provider rejects the request as an unrecognised origin and the user never reaches a sign-in screen.

### B. The token-exchange endpoint must be called via POST, not GET

Older docs call this `[GET] /oauth/token` with a JSON body. **Browsers cannot send a body on GET or HEAD requests** - the Fetch spec throws `TypeError` synchronously, and the XHR spec mandates that `send(body)` set `body` to `null` for `GET`/`HEAD`. Use `POST` with `Content-Type: application/json` and the JSON body as shown in step 2.

If a non-browser client (server, CLI, native app) really must use GET, it can - but the canonical browser-safe call is POST.

### C. Strip `exchangeToken` from the address bar BEFORE the network call

The `exchangeToken` is a one-time secret that should never linger anywhere. Removing it from `window.location.search` *after* the exchange call is too late: a failure, a slow network, a Ctrl-R reload, or a tab close can leave the token in:

- the visible address bar (shoulder-surfing, screenshot, screen-recording, accidental copy/paste/share),
- the back/forward history (so a user navigating back hits the exchange URL again with the now-used token),
- the `Referer` header of any subsequent outgoing request from the page (analytics pixels, third-party widgets, etc.).

The official SDK does this strip **synchronously, before** issuing `POST /oauth/token`, regardless of whether the exchange ultimately succeeds or fails. Manual implementations must do the same - `history.replaceState(null, '', urlWithoutExchangeToken)` immediately after parsing the value, then perform the network call.

### D. Token storage default = `sessionStorage`

`sessionStorage` discards tokens when the tab closes - the right default for an authenticated session. Use `localStorage` only when "stay signed in across tab close" is a deliberate UX choice, and understand the wider exposure surface.

### E. Refresh strategy = lazy, not timer-based

`setTimeout`/`setInterval` are unreliable in suspended/throttled tabs. Refresh on demand (when `getAccessToken()` is called and `Date.now() + leeway >= expiresAt`), not on a wall-clock schedule. The SDK uses a 60-second leeway by default.

### F. Current member on ACMA — **`GET /v1/me`**, not **`/spaces/{spaceId}/me`**

After sign-in, to load the signed-in **`ServiceUser`** (same role as **CMA** **`GET /v1/me`** for console users, but on **ACMA**):

- **Correct:** **`GET https://acma.weegloo.com/v1/me`** with the ServiceLogin Bearer Token (e.g. `auth.fetch('https://acma.weegloo.com/v1/me')` if using the SDK).

**Wrong:** **`GET https://acma.weegloo.com/v1/spaces/{spaceId}/me`**. That path is **not** the ACMA identity endpoint. **`auth.weegloo.com`** uses **`/v1/spaces/{spaceId}/...`** everywhere; **ACMA** does **not** mirror that for **`/me`**—do not interpolate `spaceId` into the URL.

Detail: **`weegloo-service-login`** skill and **`weegloo-api-endpoints`** rule.

### G. Two URLs, two lifetimes — the provider redirect URI is deploy-independent; `callbackUrl` is not

A first integrator wiring an **app that is not deployed yet** routinely stalls on "which URL do I give the provider?" — because the OAuth flow has **two** URLs that depend on different things:

| URL | Depends on the app's deploy address? | Set it when |
|---|---|---|
| **Provider "Authorized redirect URIs"** = `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}` | **No** — it always points at `auth.weegloo.com` with your `spaceId` + provider | **Now.** It is fully known the moment the Space and provider exist; nothing about it changes after you deploy. |
| **`ServiceLogin.callbackUrl`** = a page on **your product** that receives `?exchangeToken=...` | **Yes** — it is your app's own origin/path | **After the deploy URL is known.** Until then use a placeholder and patch it (and re-run any config/build step) once the subdomain is final. |

So the deploy chicken-and-egg is only apparent: you can **always** finish the provider side and create the `ServiceLogin` immediately (placeholder `callbackUrl`), then update only `callbackUrl` post-deploy via `cma_UpdateOneServiceLogin` / `cma_PatchOneServiceLogin`. Do **not** block ServiceLogin creation on having a deployed URL, and do **not** put your app's `callbackUrl` into the provider's redirect-URI field (that is pitfall **A** again).

**But `callbackUrl` is the *only* part you may placeholder. `clientId` / `clientSecret` are blocking user-only inputs** — they come from the user's own OAuth client at the chosen provider and nobody else can supply them. Without them the `ServiceLogin` cannot be created and sign-in stays **inert**. So when you reach this step: **stop, ask the user for `clientId` / `clientSecret`, and create the `ServiceLogin`** — do **not** finish with only the `ServiceUserRole` created and the credentials written off as "add later." A role created but no `ServiceLogin` is **blocked-pending-input**: end the turn by *asking for the credentials*, not by reporting the login as done. (This is the just-in-time rule of `weegloo-platform-integration` step 4 — ask at this step, not earlier, not as a closing footnote.) **When you ask, don't ask bare** — hand the user the step-by-step console walkthrough for *their* provider, with the real `{spaceId}` filled into the redirect URI. If a dedicated provider skill exists (today **`weegloo-service-login-google`** for Google, **`weegloo-service-login-github`** for GitHub, **`weegloo-service-login-kakao`** for Kakao, **`weegloo-service-login-naver`** for Naver, **`weegloo-service-login-line`** for LINE), invoke and follow it; for a provider without one (Facebook, GitLab) follow the generic shape in *Configuration responsibilities* below and look up that provider's current console steps. Do **not** give one provider's steps for another, and do **not** try to load a provider skill that doesn't exist.

## Configuration responsibilities (provider console + Weegloo Console)

Weegloo ServiceLogin is **provider-agnostic** — `ServiceLogin` is the system, a provider (Google,
GitHub, Facebook, GitLab, LINE, Kakao, Naver) is a pluggable choice. The setup below is the **same shape for every provider**;
only the console-specific clicks differ — those live in a per-provider skill **when one exists** (today Google, GitHub, Kakao, Naver, LINE); for any other provider (Facebook, GitLab), follow the generic shape below and look up that provider's current console steps.

**The shape (any provider):**

1. **Provider's developer console → create an OAuth 2.0 client (Web application).** Register the
   **Authorized redirect URI** = `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}`
   (the `/code/` form — hit by the provider → Weegloo, not the browser; pitfall **A**).
   **Deploy-independent — set it now** (pitfall **G**). Then copy that provider's `clientId` /
   `clientSecret`.
2. **Weegloo Console → ServiceLogin:**
   - `clientId` / `clientSecret` from the provider's OAuth client above. **Blocking user-only inputs —
     ask the user for them (via the per-provider walkthrough) and do not report sign-in as done without
     them (pitfall G).**
   - `defaultRole` → `Refer` to a least-privilege `ServiceUserRole` (create it first).
   - `callbackUrl` → a URL on **your product** that the SDK can intercept (Weegloo will redirect the
     browser there with `?exchangeToken=...`). **Deploy-dependent** — if the app is not deployed yet,
     set a placeholder and patch it after deploy (pitfall **G**).
3. **Product code:** call the SDK's `auth.handleCallback()` on the callback URL page. Do not roll your
   own exchange unless you cannot use the SDK.

**Per-provider console steps (Google, GitHub, Kakao, Naver, and LINE have dedicated skills today; do not invoke a provider skill that doesn't exist):**

| Provider | `{provider}` | Console-setup skill |
|---|---|---|
| Google   | `google`   | **`weegloo-service-login-google`** (detailed walkthrough) |
| GitHub   | `github`   | **`weegloo-service-login-github`** (detailed walkthrough) |
| Kakao    | `kakao`    | **`weegloo-service-login-kakao`** (detailed walkthrough) |
| Naver    | `naver`    | **`weegloo-service-login-naver`** (detailed walkthrough) |
| LINE     | `line`     | **`weegloo-service-login-line`** (detailed walkthrough) |
| Facebook | `facebook` | follow *the shape* above; look up Facebook's current app-console steps (no detailed sub-skill yet) |
| GitLab   | `gitlab`   | follow *the shape* above; look up GitLab's current app-console steps (no detailed sub-skill yet) |

**Infer the provider from the product — do not ask the user to pick one** (per `weegloo-platform-integration`'s
no-scoping-questions policy). If the product names/implies a specific provider, use it; if it doesn't,
**reason about the best-fit provider for this product and choose it — there is no built-in default, so
don't reach for Google by reflex.** The choice is surfaced — and stays correctable — at the
`clientId`/`clientSecret` ask, so you needn't ask separately. For Google, follow
`weegloo-service-login-google`; for GitHub, `weegloo-service-login-github`; for Kakao,
`weegloo-service-login-kakao`; for Naver, `weegloo-service-login-naver`; for LINE,
`weegloo-service-login-line`. For a provider with no dedicated skill (Facebook, GitLab), apply the
shape above and look up that provider's current console specifics rather than pasting a
hardcoded/possibly-stale URL.

## Native apps (Android / iOS) — bridge `callbackUrl` into the app's deep link

ServiceLogin is **not browser-only** — native mobile apps (Android, iOS) can sign in with it too. One hard constraint shapes the wiring:

> **`ServiceLogin.callbackUrl` accepts only `http` / `https` — it does NOT accept a custom deep-link scheme** (`myapp://…`, `com.example.app://…`). Weegloo only ever redirects the OAuth flow to an `http(s)` URL, so you **cannot** register the app's deep link as the `callbackUrl` directly.

The fix is a small **`https` "bridge" page that forwards into the app's deep link**, deployed as a **Weegloo WebHosting** and used as the `callbackUrl`:

1. **Build a redirect (bridge) page** — one static page whose only job is: read the query string Weegloo appended (`?exchangeToken=<one-time-code>`) and immediately navigate to the app's deep link carrying that token, e.g. `myapp://auth/callback?exchangeToken=<code>`.
2. **Deploy it as a Weegloo WebHosting** (see **`weegloo-web-hosting`**) so it has a stable, public `https://…` URL — a value `callbackUrl` accepts.
3. **Set `ServiceLogin.callbackUrl` to that WebHosting URL** (console, or `cma_UpdateOneServiceLogin` / `cma_PatchOneServiceLogin`). This is the deploy-dependent field of pitfall **G** — for a native app, the WebHosting bridge *is* "your product's callback page."
4. **Handle the deep link in the app** — the OS delivers `myapp://auth/callback?exchangeToken=…`; the app parses `exchangeToken` and runs the exchange itself (`POST …/oauth/token`, wire-protocol step 2). The JS SDK does not run here — follow *When the SDK cannot be used* below.

End-to-end:

```
app → GET …/login/oauth2/{provider}          (system browser / in-app tab)
    → provider sign-in
    → Weegloo redirects to callbackUrl = https WebHosting bridge   ?exchangeToken=…
    → bridge page redirects to   myapp://auth/callback?exchangeToken=…
    → OS hands the deep link to the app
    → app POST {exchangeToken} → …/oauth/token → accessToken (ACMA / ACDA)
```

- **Pass only the one-time `exchangeToken` through the deep link — never the durable tokens.** The bridge forwards `exchangeToken`; the *app* exchanges it for `accessToken` / `refreshToken` directly with Weegloo, so the long-lived tokens never travel through the deep link. Pitfall **C** still applies to the bridge page: strip `exchangeToken` from its own URL after forwarding.
- **Prefer verified deep links** (Android **App Links**, iOS **Universal Links**) over a bare custom URL scheme where you can — an unverified scheme can be claimed by another installed app, and `exchangeToken`, though single-use, is a bearer secret in transit. Registering the scheme/links is app-side OS config, unrelated to Weegloo.
- **The provider's OAuth client stays a "Web application" type — even for a native app.** The OAuth redirect targets `auth.weegloo.com` (a web URL), not your app, so where a provider console asks for an application type (Google, for one), pick **Web** — do not create an "Android" / "iOS" OAuth client for this flow. (Google specifics: **`weegloo-service-login-google`**.)
- **Provider-agnostic.** This bridge depends only on the `callbackUrl` scheme limit, not on which OAuth provider (Google, Kakao, …) you chose.

## When the SDK cannot be used

If a server, CLI, or native app needs to exchange tokens, follow the wire protocol above directly. Mirror the security posture:

- Do not log raw `accessToken` / `refreshToken` / `exchangeToken` in production.
- Refresh ahead of `expiresAt` with leeway.
- On logout, send the `refreshToken` so it is revoked server-side.
- Treat the Bearer Token as ACMA / ACDA / Upload only - never send it to CMA or CDA. Member-contributed media goes through Upload then ACMA Media create (see **`weegloo-service-login`**).

## Related

- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser, permission rules):** **`weegloo-service-login`** skill.
- **Per-provider console setup (the clicks to obtain `clientId`/`clientSecret`):** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE); Facebook and GitLab follow the same shape — see *Configuration responsibilities*.
- **Role filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Base URLs and Accept-header rules:** **`weegloo-api-endpoints`** rule.
- **Picking the right API per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — the *other* login model in Weegloo; CMA / Upload / CDA):** **`weegloo-user-login`** skill.
- **Public read tokens (CDA, no member sign-in):** **`weegloo-delivery-access-token`** skill.
