# Native apps (Android / iOS) — the ServiceLogin app path

Read this **only when the client is a native Android or iOS app.** A browser integration needs none
of it. This page assumes you have the SKILL.md spine: the wire protocol (login entry, `POST
/oauth/token`, refresh, logout), pitfalls **A**–**G**, and the `ServiceLogin` create fields.

ServiceLogin is **not browser-only**. A native app is returned **straight into its own deep link** and
runs the exchange itself. Two steps are required that the browser path does not have.

**There is no native SDK.** `weegloo-service-user` is a browser JavaScript package — do not add it to
an Android or iOS project, and do not look for a Kotlin / Swift equivalent. On these platforms the
whole integration is the HTTP calls in the spine's *OAuth wire protocol* section plus the parameters
below, made with the platform's own HTTP client (`OkHttp`, `URLSession`, …).

## 1. Register the app's callback in `ServiceLogin.allowedCallbackUrls` — hard gate

**A `redirect_uri` that is not registered is rejected at the login entry**, before the user ever sees
a provider sign-in screen. Do this **before the first sign-in attempt**.

- **Creating the `ServiceLogin` now** — put `allowedCallbackUrls` in the create body.
- **A `ServiceLogin` already exists** — the usual case, because the web product shipped first. **You
  must update it.** Prefer **`cma_PatchOneServiceLogin`** to append one entry.
  **`cma_UpdateOneServiceLogin` is a full replacement**, and `allowedCallbackUrls` and
  `approvalRequired` are the two fields that **default when omitted** — a PUT that leaves them out
  silently clears the callback list and turns approval off. Resend the whole resource.

```json
"allowedCallbackUrls": [
  { "url": "myapp://login", "refreshTokenTtlInSec": 2592000 }
]
```

- `url` — an absolute URI of **any scheme**, with **no fragment**; a custom scheme (`myapp://login`)
  and an App Link / Universal Link (`https://app.example.com/cb`) are equally accepted. **At most 10
  entries.**
- `refreshTokenTtlInSec` — optional; sets the refresh-token lifetime for logins returning through
  that callback. Mobile sessions usually want this longer than the platform default.

Unlike `callbackUrl`, this value does **not** depend on a deploy address (spine pitfall **F**), so
register it as soon as the Space exists.

## 2. Drive the flow with `redirect_uri` + PKCE

Open the entry URL in the **system browser** — Android **Custom Tabs**, iOS
**`ASWebAuthenticationSession`**. Providers block in-app `WebView`.

```
GET https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/{provider}
      ?redirect_uri=myapp://login
      &code_challenge=<BASE64URL(SHA256(code_verifier)), unpadded>
      &code_challenge_method=S256
      &state=<opaque value the app generates>
```

- `code_verifier` — 43–512 chars, **freshly generated per attempt**; keep it in memory for step 3.
- `code_challenge` — unpadded BASE64URL of `SHA256(code_verifier)`; `code_challenge_method=S256`.
- `redirect_uri` — must exactly match one registered entry from step 1.
- `state` — optional, opaque, comes back untouched.

Weegloo then returns to the registered `redirect_uri`:

```
myapp://login?exchangeToken=<one-time-code>&state=...           success
myapp://login?error=<reason>&contact=<support email>&state=...  failure
```

`error` is one of **`signup_limit_exceeded`**, **`approval_required`**, **`email_conflict`**,
**`email_required`**, **`server_error`**. Branch on it and write your own copy — **Weegloo sends no
localized text.** `contact` is the `ServiceLogin.contactEmail` you configured; show it on the
failure screen.

## 3. Exchange, carrying the verifier

Exactly the spine's wire-protocol step 2 (`POST https://auth.weegloo.com/v1/spaces/{spaceId}/oauth/token`,
`Content-Type: application/json`), with one extra field:

```json
{ "exchangeToken": "...", "codeVerifier": "..." }
```

The response, refresh (step 3) and logout (step 4) are identical to the browser path.

## Native-specific rules

- **The provider's OAuth client stays a "Web application" type — even for a native app.** The OAuth
  redirect targets `auth.weegloo.com`, not your app, so where a provider console asks for an
  application type, pick **Web**; do **not** create an "Android" / "iOS" client for this flow. (Google
  specifics: **`references/google.md`**.) Provider SDK / app-to-app sign-in is not part of
  this flow.
- **Prefer verified deep links** — Android **App Links**, iOS **Universal Links** — over a bare custom
  scheme. An unverified scheme can be claimed by another installed app, and `exchangeToken`, though
  single-use, is a bearer secret in transit. Registering either is app-side OS config, unrelated to
  Weegloo.
- **Provider-agnostic.** Nothing on this page depends on which OAuth provider the Space uses.
- **Security posture:** the spine's *When the SDK cannot be used* list applies unchanged — never log
  raw `accessToken` / `refreshToken` / `exchangeToken`, refresh ahead of `expiresAt` with leeway, send
  the `refreshToken` on logout so it is revoked, and treat the Bearer as **ACMA / ACDA / Upload only**
  — never CMA / CDA. Store tokens in the platform keystore (Android **EncryptedSharedPreferences** /
  Keystore, iOS **Keychain**), not in plain preferences or a file.
