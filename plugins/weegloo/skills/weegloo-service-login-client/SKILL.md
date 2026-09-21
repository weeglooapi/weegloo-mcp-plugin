---
name: weegloo-service-login-client
description: Weegloo ServiceLogin OAuth sign-in — Google, GitHub, Facebook, GitLab, LINE, Kakao, Naver — for a browser or native Android / iOS app: the auth.weegloo.com wire protocol, the npm SDK `weegloo-service-user`, and each provider's console setup in `references/{provider}.md`. Provider inferred, never asked, no default. Covers login redirect, token exchange, refresh, logout; login-entry URL vs provider redirect URI; ACMA current user at GET /v1/me; the native path (allowedCallbackUrls deep link, PKCE, no SDK). Use when wiring sign-in or debugging the callback. 로그인, 소셜 로그인, 회원가입, OAuth 연동, 구글/카카오/네이버/깃허브/라인/페이스북/깃랩 로그인.
---

# Weegloo - ServiceLogin client integration (wire protocol + browser SDK)

This skill covers the **implementation layer** of Weegloo ServiceLogin: the exact HTTP endpoints on `auth.weegloo.com`, the official browser SDK that wraps them, the native Android / iOS path, and the gotchas that bite first-time integrators.

> **Prerequisite gate:** this is the *implementation* skill. The **conceptual model** — `ServiceLogin` / `ServiceUserRole` / `ServiceUser`, `defaultRole` / `roleOverride`, ACMA/ACDA scope, the CMA/CDA token boundary — lives in **`weegloo-service-login`**; **read it first**. Landing here for a concrete question (e.g. "what redirect URI?") does **not** mean the design decisions are settled — do not create a `ServiceLogin` / `ServiceUserRole` having only read this skill.

For Weegloo base-URL conventions and the vendor JSON media type - see the **`weegloo-api-endpoints`** rule.

**Pick the path first - browser or native app.** They differ only in the rows below; every endpoint
and payload on this page is identical for both.

| | Browser (web) | Native app (Android / iOS) |
|---|---|---|
| Client library | `weegloo-service-user` npm SDK | **none — call these endpoints yourself** |
| Callback destination | `ServiceLogin.callbackUrl` | one entry of `ServiceLogin.allowedCallbackUrls`, chosen per request with `redirect_uri` |
| Extra registration | none | **required** - the app's callback must be in `allowedCallbackUrls` first |
| PKCE | not used | **required** - `code_challenge` on entry, `code_verifier` on exchange |

**Browser is the common path and is complete on this page** — a web integration needs nothing else
from this skill.

> 📱 **Building a native Android / iOS app? Read `references/native-apps.md` now, in addition to this
> page.** It carries the two steps the browser path does not have, and the first is a **hard gate**:
> the app's deep link (`myapp://login`, an App Link / Universal Link) **must already be registered in
> `ServiceLogin.allowedCallbackUrls`** or the login entry rejects the request before the user ever
> sees a sign-in screen. **There is no native SDK** — `weegloo-service-user` is a browser JavaScript
> package; do not add it to an Android or iOS project and do not look for a Kotlin / Swift
> equivalent. On those platforms the integration *is* the HTTP calls below, made with the platform's
> own HTTP client.

## Recommended path: use the official SDK (browser only)

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

Pinned version (production - replace `<hash>` with the value from `manifest.json`):

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

**Decision aid:** the SDK is a **browser JavaScript** package — if the integration runs in a browser at all, prefer it. Everywhere else (a native Android / iOS app, a server-to-server token swap, a scripted backfill) there is no SDK to install: implement the wire protocol below directly.

> **`provider` init option:** the SDK's own default is `'google'`, but **that is the SDK's default, not
> a design default.** Always set it explicitly to the provider you inferred — see *Provider selection*
> under *Configuration responsibilities*.

## OAuth wire protocol on `auth.weegloo.com`

All paths are under `/v1/spaces/{spaceId}/...`. All bodies and responses are JSON. The SDK makes these
calls for you; read them to debug a callback, or to implement the flow where the SDK cannot run.

### 1. Login entry - the browser navigates here (a native app opens this in the system browser)

```
GET https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/{provider}
```

- `{provider}` is one of Weegloo's supported providers — currently **`google`**, **`github`**, **`facebook`**, **`gitlab`**, **`line`**, **`kakao`**, **`naver`**. Which one to use is **inferred, never asked** — see *Provider selection* below. (Confirm the current set from the `ServiceLogin` schema / docs if unsure.)
- This is a **navigation** target, not an XHR/fetch call - assign it to `window.location` so the browser follows the OAuth redirect chain.
- After provider sign-in, Weegloo redirects the browser to the `callbackUrl` registered on the `ServiceLogin` resource, appending `?exchangeToken=<one-time-code>`. A native app sends `redirect_uri` here instead and comes back to its own deep link - see `references/native-apps.md`.

### 2. Token exchange - first thing on the callback page

```
POST https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/token
Content-Type: application/json

{ "exchangeToken": "<value-from-query-string>" }
```

Add `codeVerifier` **only** when the login was started with a `code_challenge` (the native path); a
browser login omits it.

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

The `accessToken` is the Bearer Token usable against ACMA / ACDA / Upload - **not** CMA / CDA (see **`weegloo-service-login`** for the scope rule).

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

### 5. The signed-in member

`GET https://acma.weegloo.com/v1/me` with that Bearer — e.g. `auth.fetch('https://acma.weegloo.com/v1/me')`.

*(The `/v1/spaces/{spaceId}/me` trap is stated in the always-loaded `weegloo-api-endpoints` rule and in
`weegloo-service-login`; not repeated here.)*

## Critical pitfalls

### A. Login entry URL ≠ the provider redirect URI

These two URLs differ by one path segment and are routinely confused:

| URL | Who calls it | Where it is configured |
|---|---|---|
| `…/login/oauth2/{provider}` | The end user's **browser** (the SDK's `auth.login()` navigates here) | - |
| `…/login/oauth2/code/{provider}` | **The provider → Weegloo** as the OAuth code callback | The provider's developer console → "Authorized redirect URIs" |

If you put `/code/` in the user-facing entry URL, the provider rejects the request as an unrecognised origin and the user never reaches a sign-in screen.

### B. The token-exchange endpoint must be called via POST, not GET

**Browsers cannot send a body on GET or HEAD requests** - the Fetch spec throws `TypeError` synchronously, and the XHR spec mandates that `send(body)` set `body` to `null` for `GET`/`HEAD`. A `GET /oauth/token` carrying a JSON body therefore cannot work in a browser: use `POST` with `Content-Type: application/json` and the JSON body as shown in step 2.

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

### F. Two URLs, two lifetimes — the provider redirect URI is deploy-independent; `callbackUrl` is not

A first integrator wiring an **app that is not deployed yet** routinely stalls on "which URL do I give the provider?" — because the OAuth flow has **two** URLs that depend on different things:

| URL | Depends on the app's deploy address? | Set it when |
|---|---|---|
| **Provider "Authorized redirect URIs"** = `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}` | **No** — it always points at `auth.weegloo.com` with your `spaceId` + provider | **Now.** It is fully known the moment the Space and provider exist; nothing about it changes after you deploy. |
| **`ServiceLogin.callbackUrl`** = a page on **your product** that receives `?exchangeToken=...` | **Yes** — it is your app's own origin/path | **After the deploy URL is known.** Until then use a placeholder and patch it (and re-run any config/build step) once the subdomain is final. |

So the deploy chicken-and-egg is only apparent: you can **always** finish the provider side and create the `ServiceLogin` immediately (placeholder `callbackUrl`), then update only `callbackUrl` post-deploy via `cma_UpdateOneServiceLogin` / `cma_PatchOneServiceLogin`. Do **not** block ServiceLogin creation on having a deployed URL, and do **not** put your app's `callbackUrl` into the provider's redirect-URI field (that is pitfall **A** again).

Because it is deploy-independent, **hand the redirect URI to the user up front and again in the
completion message** — the when/why/green-presentation is owned by `weegloo-service-login` →
*Tell the user the provider Redirect URI UP FRONT*, and is not repeated here.

### G. `clientId` / `clientSecret` are blocking, user-only inputs

`callbackUrl` is the *only* part you may placeholder. `clientId` / `clientSecret` come from the user's own OAuth client at the chosen provider and nobody else can supply them. Without them the `ServiceLogin` cannot be created and sign-in stays **inert**. So when you reach this step: **stop, ask the user for `clientId` / `clientSecret`, and create the `ServiceLogin`** — do **not** finish with only the `ServiceUserRole` created and the credentials written off as "add later." A role created but no `ServiceLogin` is **blocked-pending-input**: end the turn by *asking for the credentials*, not by reporting the login as done. (This is the just-in-time rule of `weegloo-platform-integration` step 4 — ask at this step, not earlier, not as a closing footnote.) **When you ask, don't ask bare, and don't retype the provider's console path** — read the chosen provider's `references/{provider}.md` page (table below) and hand the user **that provider's illustrated doc page** (`https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/{provider}`) **plus the redirect URI with the real `{spaceId}` filled in**, then the few constraints the doc cannot decide for them (which key is the `clientId`, a toggle that must be on, a secret shown only once). A menu path written out from memory goes stale the next time that console is rearranged, and the user hunts for a screen that moved. Do **not** give one provider's page or URI for another.

## Configuration responsibilities (provider console + Weegloo Console)

Weegloo ServiceLogin is **provider-agnostic** — `ServiceLogin` is the system, a provider (Google,
GitHub, Facebook, GitLab, LINE, Kakao, Naver) is a pluggable choice. The setup below is the **same shape for every provider**;
only the console-specific clicks differ — those live in `references/{provider}.md`, one page per provider.

**The shape (any provider):**

1. **Provider's developer console → create an OAuth 2.0 client (Web application).** Register the
   **Authorized redirect URI** = `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}`
   (the `/code/` form — hit by the provider → Weegloo, not the browser; pitfall **A**).
   **Deploy-independent — set it now** (pitfall **F**). Then copy that provider's `clientId` /
   `clientSecret`.
2. **Create the `ServiceLogin` yourself** — **`cma_CreateServiceLogin`**, not the user clicking through
   the console. The fields split by who can supply them.

   **Ask the user — nobody else can produce these:**
   - `providers` → a **list** (1–10), not a pair of top-level fields. Each entry is
     `{ registrationId, clientId, clientSecret, clientName? }`, where `registrationId` is the provider
     key (`google`, `github`, …) — the same value as `{provider}` elsewhere on this page. The
     `clientId` / `clientSecret` from step 1 go **inside an entry**. **Blocking — do not report sign-in
     as done without them (pitfall G).**

   **You supply these:**
   - `name` → 1–30 chars, the service name the end user sees while signing in. Derive it from the product.
   - `contactEmail` → the service manager's address, shown to the end user when a sign-in is refused.
     **Derive it; do not ask.** Use `support@<the product's domain>` when the product has a domain,
     otherwise the address of the account you are setting this up with. Unlike `providers`, this one
     **is** editable afterwards (`cma_UpdateOneServiceLogin` carries it), so an address the owner
     refines later costs nothing while a blocking question costs a turn.
   - `defaultRole` → `Refer` to a least-privilege `ServiceUserRole` (create it first).
   - `callbackUrl` → a URL on **your product** that the SDK can intercept (Weegloo will redirect the
     browser there with `?exchangeToken=...`). **Deploy-dependent** — if the app is not deployed yet,
     set a placeholder and patch it after deploy (pitfall **F**).
   - `allowedCallbackUrls` → **native apps only**; see `references/native-apps.md`.

   ⚠️ **Settle the provider list at creation time.** `cma_UpdateOneServiceLogin` has no `providers`
   field, and no MCP tool edits the provider list — so once the `ServiceLogin` exists you cannot add,
   swap, or drop a provider with the tools you have. Decide which provider(s) the product needs before
   you call `cma_CreateServiceLogin`.
3. **Product code:** call the SDK's `auth.handleCallback()` on the callback URL page. Do not roll your
   own exchange unless you cannot use the SDK.

### Provider selection — infer it, never ask

**Infer the provider from the product — do not ask the user to pick one** (per `weegloo-platform-integration`'s
no-scoping-questions policy), and **do not treat any provider as the built-in default** (don't reflexively
reach for `google` — the SDK's `provider` default is the SDK's, not a design default). If the product
names or implies one (e.g. a "Sign in with GitHub" button), use that; if nothing indicates one,
**reason about which fits this product best and choose it.** The choice is surfaced — and stays
correctable — when you ask for that provider's `clientId` / `clientSecret` (pitfall **G**), so no
separate "which provider?" question is needed. The only thing to avoid is wiring one provider's flow
as another's, or giving one provider's console steps for a different product.

### Per-provider console steps (every provider has one)

| Provider | `{provider}` | Console-setup page |
|---|---|---|
| Google   | `google`   | **`references/google.md`** |
| GitHub   | `github`   | **`references/github.md`** |
| Kakao    | `kakao`    | **`references/kakao.md`** |
| Naver    | `naver`    | **`references/naver.md`** |
| LINE     | `line`     | **`references/line.md`** |
| Facebook | `facebook` | **`references/facebook.md`** |
| GitLab   | `gitlab`   | **`references/gitlab.md`** |

**Read the page for the chosen provider — what it carries exists nowhere else.** Each one gives that
provider's exact redirect URI, the mapping between its vocabulary and Weegloo's (`clientId` is a
*REST API key* on Kakao, a *Channel ID* on LINE, an *App ID* on Facebook), its own traps, and the
illustrated guide **to hand the user in place of a console walkthrough** at
`https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/{provider}`,
keyed by the same `{provider}` value as the table. The same value is what goes in the ServiceLogin's
`providers` entry as **`registrationId`**.

## When the SDK cannot be used

If a server, CLI, or native app needs to exchange tokens, follow the wire protocol above directly. Mirror the security posture:

- Do not log raw `accessToken` / `refreshToken` / `exchangeToken` in production.
- Refresh ahead of `expiresAt` with leeway.
- On logout, send the `refreshToken` so it is revoked server-side.
- Treat the Bearer Token as ACMA / ACDA / Upload only - never send it to CMA or CDA. Member-contributed media goes through Upload then ACMA Media create (see **`weegloo-service-login`**).

## References (read only when the branch applies)

- **`references/{provider}.md`** — the console setup for ONE provider: `google`, `github`, `kakao`,
  `naver`, `line`, `facebook`, `gitlab` (table above). Read the one you are wiring, and only that
  one. **This is not optional detail** — the redirect URI to register, the doc page to hand over and
  the provider's own traps are there and nowhere else, so an answer written from this spine alone
  asks the user for `clientId` / `clientSecret` with no idea where to find them.
- **`references/native-apps.md`** — read it **whenever the client is a native Android or iOS app**
  (and not otherwise). Carries the `allowedCallbackUrls` registration gate, the `redirect_uri` + PKCE
  entry parameters, the deep-link error returns, and the "Web application" OAuth-client-type rule.

## Related

- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser, permission rules):** **`weegloo-service-login`** skill.
- **Per-provider console setup:** the table above.
- **Role filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Base URLs and Accept-header rules:** **`weegloo-api-endpoints`** rule.
- **Picking the right API per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — the *other* login model in Weegloo; CMA / Upload / CDA):** **`weegloo-user-login`** skill.
- **Public read tokens (CDA, no member sign-in):** **`weegloo-delivery-access-token`** skill.
