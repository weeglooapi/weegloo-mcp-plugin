---
name: weegloo-service-login-sdk
description: How to add Weegloo ServiceLogin (OAuth 2.0 — Google, GitHub, or Facebook) sign-in to a browser app — the official npm SDK `weegloo-service-user` (vanilla JS, 0 deps) and the underlying `auth.weegloo.com` HTTP wire protocol (login redirect, exchangeToken POST, refresh, logout), all parameterized by `{provider}` (never assume Google). Covers the entry-URL vs provider redirect-URI confusion, ACMA current user at GET https://acma.weegloo.com/v1/me (not /spaces/{spaceId}/me), the browser GET-with-body limitation, and the `exchangeToken` URL-stripping security pattern. This is the provider-agnostic spine; Google's detailed console steps live in `weegloo-service-login-google` (GitHub/Facebook follow the same generic shape described here — no dedicated skill yet). Use when wiring sign-in for a Weegloo Space's product, debugging the OAuth callback flow, or implementing the protocol where the JS SDK cannot run (server-side, native mobile, scripts).
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
  const auth = WeeglooServiceLogin.init({ spaceId: 'YOUR_SPACE_ID' });

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
const auth = WeeglooServiceLogin.init({ spaceId: 'YOUR_SPACE_ID' });
```

**Decision aid:** if the integration runs in a browser at all, prefer the SDK. Re-implement the protocol manually only when the platform makes it impossible (e.g. a native mobile app, a server-to-server token swap, or a scripted backfill).

## OAuth wire protocol on `auth.weegloo.com`

All paths are under `/v1/spaces/{spaceId}/...`. All bodies and responses are JSON.

### 1. Login entry - browser navigates here

```
GET https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/{provider}
```

- `{provider}` is one of Weegloo's supported providers — currently **`google`**, **`github`**, **`facebook`**. Use the one the product actually needs; **never hardcode `google`**. (Confirm the current set from the `ServiceLogin` schema / docs if unsure.)
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
  "scope":             ["App"],
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
| **`ServiceLogin.callbackUrl`** = a page on **your product** that receives `?exchangeToken=...` | **Yes** — it is your app's own origin/path | **After the deploy URL is known.** Until then use a placeholder and patch it (and re-run codegen / config) once the subdomain is final. |

So the deploy chicken-and-egg is only apparent: you can **always** finish the provider side and create the `ServiceLogin` immediately (placeholder `callbackUrl`), then update only `callbackUrl` post-deploy via `cma_UpdateOneServiceLogin` / `cma_PatchOneServiceLogin`. Do **not** block ServiceLogin creation on having a deployed URL, and do **not** put your app's `callbackUrl` into the provider's redirect-URI field (that is pitfall **A** again).

**But `callbackUrl` is the *only* part you may placeholder. `clientId` / `clientSecret` are blocking user-only inputs** — they come from the user's own OAuth client at the chosen provider and nobody else can supply them. Without them the `ServiceLogin` cannot be created and sign-in stays **inert**. So when you reach this step: **stop, ask the user for `clientId` / `clientSecret`, and create the `ServiceLogin`** — do **not** finish with only the `ServiceUserRole` created and the credentials written off as "add later." A role created but no `ServiceLogin` is **blocked-pending-input**: end the turn by *asking for the credentials*, not by reporting the login as done. (This is the just-in-time rule of `weegloo-platform-integration` step 4 — ask at this step, not earlier, not as a closing footnote.) **When you ask, don't ask bare** — hand the user the step-by-step console walkthrough for *their* provider, with the real `{spaceId}` filled into the redirect URI. If a dedicated provider skill exists (today only **`weegloo-service-login-google`**), invoke and follow it; for any other provider follow the generic shape in *Configuration responsibilities* below and look up that provider's current console steps. Do **not** give Google's steps for a non-Google provider, and do **not** try to load a provider skill that doesn't exist.

## Configuration responsibilities (provider console + Weegloo Console)

Weegloo ServiceLogin is **provider-agnostic** — `ServiceLogin` is the system, a provider (Google,
GitHub, Facebook) is a pluggable choice. The setup below is the **same shape for every provider**;
only the console-specific clicks differ, and those live in a per-provider skill.

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

**Per-provider console steps (only Google has a dedicated skill today; do not invoke a provider skill that doesn't exist):**

| Provider | `{provider}` | Console-setup skill |
|---|---|---|
| Google   | `google`   | **`weegloo-service-login-google`** (detailed walkthrough) |
| GitHub   | `github`   | follow *the shape* above; look up GitHub's current OAuth-app console steps (no detailed sub-skill yet) |
| Facebook | `facebook` | follow *the shape* above; look up Facebook's current app-console steps (no detailed sub-skill yet) |

Pick the provider from the **product's actual need**, never default to Google. For Google, follow
`weegloo-service-login-google`. For GitHub/Facebook, apply the shape above and look up that provider's
current console specifics rather than pasting a hardcoded/possibly-stale URL.

## When the SDK cannot be used

If a server, CLI, or native app needs to exchange tokens, follow the wire protocol above directly. Mirror the security posture:

- Do not log raw `accessToken` / `refreshToken` / `exchangeToken` in production.
- Refresh ahead of `expiresAt` with leeway.
- On logout, send the `refreshToken` so it is revoked server-side.
- Treat the Bearer Token as ACMA / ACDA / Upload only - never send it to CMA or CDA. Member-contributed media goes through Upload then ACMA Media create (see **`weegloo-service-login`**).

## Related

- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser, permission rules):** **`weegloo-service-login`** skill.
- **Per-provider console setup (the clicks to obtain `clientId`/`clientSecret`):** **`weegloo-service-login-google`** (Google; GitHub/Facebook follow the same shape — see *Configuration responsibilities*).
- **Role filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Base URLs and Accept-header rules:** **`weegloo-api-endpoints`** rule.
- **Picking the right API per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — the *other* login model in Weegloo; CMA / Upload / CDA):** **`weegloo-user-login`** skill.
- **Public read tokens (CDA, no member sign-in):** **`weegloo-delivery-access-token`** skill.
