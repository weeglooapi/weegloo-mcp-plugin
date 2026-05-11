---
name: weegloo-service-login-sdk
description: How to add Weegloo ServiceLogin (Google OAuth 2.0) sign-in to a browser app — the official npm SDK `weegloo-service-user` (vanilla JS, 0 deps) and the underlying `auth.weegloo.com` HTTP wire protocol (login redirect, exchangeToken POST, refresh, logout). Covers the entry-URL vs Google redirect-URI confusion, ACMA current user at GET https://acma.weegloo.com/v1/me (not /spaces/{spaceId}/me), the browser GET-with-body limitation, and the `exchangeToken` URL-stripping security pattern. Use when wiring sign-in for a Weegloo Space's product, debugging the OAuth callback flow, or implementing the protocol where the JS SDK cannot run (server-side, native mobile, scripts).
---

# Weegloo — ServiceLogin SDK / OAuth wire protocol

This skill covers the **implementation layer** of Weegloo ServiceLogin: the official browser SDK, the exact HTTP endpoints on `auth.weegloo.com`, and the browser-specific gotchas that bite first-time integrators.

For the **conceptual model** — what `ServiceLogin` / `ServiceUserRole` / `ServiceUser` are, how `roleOverride` and `isAdmin` work, ACMA/ACDA scope rules — see the **`weegloo-service-login`** skill.

For Weegloo base-URL conventions and the vendor JSON media type — see the **`weegloo-api-endpoints`** rule.

## Recommended path: use the official SDK

Browser apps (static sites, Weegloo WebHosting, SPAs, Next.js, etc.) should use the **`weegloo-service-user`** npm package. It encapsulates every step described below — login redirect, callback handling, token storage, auto-refresh, ACMA/ACDA `Authorization` injection, and the `exchangeToken` security stripping.

- npm: `https://www.npmjs.com/package/weegloo-service-user`
- jsDelivr (script tag): `https://cdn.jsdelivr.net/npm/weegloo-service-user@1/dist/weegloo-service-login.min.js`
- Source: vanilla JavaScript, zero runtime dependencies, ships UMD + ESM + minified

Minimal usage:

```html
<script src="https://cdn.jsdelivr.net/npm/weegloo-service-user@1/dist/weegloo-service-login.min.js"></script>
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

### 1. Login entry — browser navigates here

```
GET https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/{provider}
```

- `{provider}` is `google` (and any other future provider Weegloo adds).
- This is a **navigation** target, not an XHR/fetch call — assign it to `window.location` so the browser follows the OAuth redirect chain.
- After provider sign-in, Weegloo redirects the browser to the `callbackUrl` registered on the `ServiceLogin` resource, appending `?exchangeToken=<one-time-code>`.

### 2. Token exchange — first thing on the callback page

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

The `accessToken` is the Bearer Token usable against ACMA / ACDA — **not** CMA / CDA (see **`weegloo-service-login`** for the scope rule).

### 3. Refresh — before `expiresAt`

```
POST https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/refresh
Content-Type: application/json

{ "refreshToken": "..." }
```

Returns the same shape as the exchange response. Some refresh responses may omit `refreshToken` — preserve the previously stored one in that case.

### 4. Logout

```
DELETE https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/token
Content-Type: application/json

{ "refreshToken": "..." }
```

Sending `refreshToken` is **strongly recommended** so the server can revoke it. Calling without a body is permitted but leaves the refresh token usable until natural expiry.

## Critical pitfalls

### A. Login entry URL ≠ Google redirect URI

These two URLs differ by one path segment and are routinely confused:

| URL | Who calls it | Where it is configured |
|---|---|---|
| `…/login/oauth2/{provider}` | The end user's **browser** (the SDK's `auth.login()` navigates here) | — |
| `…/login/oauth2/code/{provider}` | **Google → Weegloo** as the OAuth code callback | Google Cloud Console → "Authorized redirect URIs" |

If you put `/code/` in the user-facing entry URL, Google rejects the request as an unrecognised origin and the user never reaches a sign-in screen.

### B. The token-exchange endpoint must be called via POST, not GET

Older docs call this `[GET] /oauth/token` with a JSON body. **Browsers cannot send a body on GET or HEAD requests** — the Fetch spec throws `TypeError` synchronously, and the XHR spec mandates that `send(body)` set `body` to `null` for `GET`/`HEAD`. Use `POST` with `Content-Type: application/json` and the JSON body as shown in step 2.

If a non-browser client (server, CLI, native app) really must use GET, it can — but the canonical browser-safe call is POST.

### C. Strip `exchangeToken` from the address bar BEFORE the network call

The `exchangeToken` is a one-time secret that should never linger anywhere. Removing it from `window.location.search` *after* the exchange call is too late: a failure, a slow network, a Ctrl-R reload, or a tab close can leave the token in:

- the visible address bar (shoulder-surfing, screenshot, screen-recording, accidental copy/paste/share),
- the back/forward history (so a user navigating back hits the exchange URL again with the now-used token),
- the `Referer` header of any subsequent outgoing request from the page (analytics pixels, third-party widgets, etc.).

The official SDK does this strip **synchronously, before** issuing `POST /oauth/token`, regardless of whether the exchange ultimately succeeds or fails. Manual implementations must do the same — `history.replaceState(null, '', urlWithoutExchangeToken)` immediately after parsing the value, then perform the network call.

### D. Token storage default = `sessionStorage`

`sessionStorage` discards tokens when the tab closes — the right default for an authenticated session. Use `localStorage` only when "stay signed in across tab close" is a deliberate UX choice, and understand the wider exposure surface.

### E. Refresh strategy = lazy, not timer-based

`setTimeout`/`setInterval` are unreliable in suspended/throttled tabs. Refresh on demand (when `getAccessToken()` is called and `Date.now() + leeway >= expiresAt`), not on a wall-clock schedule. The SDK uses a 60-second leeway by default.

### F. Current member on ACMA — **`GET /v1/me`**, not **`/spaces/{spaceId}/me`**

After sign-in, to load the signed-in **`ServiceUser`** (same role as **CMA** **`GET /v1/me`** for console users, but on **ACMA**):

- **Correct:** **`GET https://acma.weegloo.com/v1/me`** with the ServiceLogin Bearer Token (e.g. `auth.fetch('https://acma.weegloo.com/v1/me')` if using the SDK).

**Wrong:** **`GET https://acma.weegloo.com/v1/spaces/{spaceId}/me`**. That path is **not** the ACMA identity endpoint. **`auth.weegloo.com`** uses **`/v1/spaces/{spaceId}/...`** everywhere; **ACMA** does **not** mirror that for **`/me`**—do not interpolate `spaceId` into the URL.

Detail: **`weegloo-service-login`** skill and **`weegloo-api-endpoints`** rule.

## Configuration responsibilities (Google Cloud + Weegloo Console)

When wiring up a new `ServiceLogin` for a Space, an integrator must:

1. **Google Cloud Console → OAuth client:**
   - Authorized JavaScript origin: `https://auth.weegloo.com`
   - Authorized redirect URI: `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}` (note the `/code/` segment — this URI is hit by Google → Weegloo, not by the browser).
2. **Weegloo Console → ServiceLogin:**
   - `clientId` / `clientSecret` from the Google OAuth client above.
   - `defaultRole` → `Refer` to a least-privilege `ServiceUserRole` (create it first).
   - `callbackUrl` → a URL on **your product** that the SDK can intercept (Weegloo will redirect the browser there with `?exchangeToken=...`).
3. **Product code:** call the SDK's `auth.handleCallback()` on the callback URL page. Do not roll your own exchange unless you cannot use the SDK.

## When the SDK cannot be used

If a server, CLI, or native app needs to exchange tokens, follow the wire protocol above directly. Mirror the security posture:

- Do not log raw `accessToken` / `refreshToken` / `exchangeToken` in production.
- Refresh ahead of `expiresAt` with leeway.
- On logout, send the `refreshToken` so it is revoked server-side.
- Treat the Bearer Token as ACMA/ACDA-only — never send it to CMA, CDA, or Upload.

## Related

- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser, permission rules):** **`weegloo-service-login`** skill.
- **Base URLs and Accept-header rules:** **`weegloo-api-endpoints`** rule.
- **Picking the right API per service type:** **`weegloo-service-architecture`** skill.
- **Console FE login (CMA admin, different identity model):** **`weegloo-web-hosting-fe-login`** skill.
- **Public read tokens (CDA, no member sign-in):** **`weegloo-delivery-access-token`** skill.
