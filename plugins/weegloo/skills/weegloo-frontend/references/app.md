# Native app frontend (Android / iOS)

Read this when the target is a **native app** rather than a web page. It assumes the spine
(`SKILL.md`). The spine's Web sections do **not** apply: there is no SPA fallback, no ZIP and no
WebHosting in this branch — **`weegloo-web-hosting` is not part of an app build at all**, and a
"deploy" here means the app stores, which is the user's step, not yours.

This branch is deliberately short. Most of what an app needs is owned by other skills, and those
skills — not a copy here — are what to read.

## What actually differs from the browser

- **Sign-in is the one path with app-specific mechanics.** The callback is a **deep link**
  (`myapp://login`, an App Link / Universal Link) and it must be registered in
  **`ServiceLogin.allowedCallbackUrls`** *before* the first sign-in attempt, or the login entry
  rejects the request. The app flow carries `redirect_uri` + **PKCE** and does **not** use the
  browser SDK. Owner: **`weegloo-service-login-client`**, which carries the native-app branch in
  full. Read it before writing any of it; nothing about this flow is guessable from the browser
  version.
- **There is no build-time env inlining to imitate.** The web branch bakes config into the bundle
  because WebHosting has no server; an app ships its config in the binary the same way, but the
  delivery token still belongs to a **least-privilege `DeliveryAccessToken`**
  (`weegloo-delivery-access-token`) — an app binary is as readable as a JS bundle.
- **Uploads go through the Upload REST API from the app's own code**
  (**`weegloo-upload-api`**) — never the `weegloo-upload` MCP, which is the agent's tool for local
  files in a chat.
- **Member data** is the same ACMA / ACDA plane as the web branch (`weegloo-service-architecture`),
  with the same `createdBy :self` scoping (`weegloo-space-role`).

## Maps in an app

The key in the spine is a **Maps Embed API** key — it authorizes the `<iframe>`, not a native map
SDK. In an app, render the same embed URL in a **WebView** and nothing needs to be asked for. A
**native** Google Maps SDK would require the user's own key with that SDK enabled; treat that as a
genuine user-only input and say so rather than shipping a map that cannot initialise.

## Screens that read Weegloo

Identical to the web branch and owned elsewhere: `weegloo-api-query-optimization` (projection,
`sys.id[in]`, `/style1`…`/style10` thumbnails), `weegloo-cda-publish` (only published rows are
delivered), `weegloo-default-locale` (delivery flattens `fields.{name}`; management does not).
